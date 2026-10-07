const express = require('express');
const db = require('../db');
const orders = require('../services/orders');
const settings = require('../services/settings');
const shipping = require('../services/shipping');
const { authenticate } = require('../middleware/auth');
const { HttpError, asyncHandler, required, toInt, toBool, normalizePhone } = require('../utils');
const { absUrl } = require('../media');

const router = express.Router();
router.use(authenticate);

const orderOut = (req, o) => ({
  ...o,
  // eslint-disable-next-line no-unused-vars -- harga modal tidak dikirim ke pelanggan
  items: o.items?.map(({ cost_price, ...i }) => ({ ...i, image_url: absUrl(req, i.image_url) })),
});

// ------------------------------------------------------------------ alamat
router.get('/addresses', (req, res) => {
  const rows = db.get().prepare('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC').all(req.user.id).map(db.plain);
  res.json({ data: rows.map((a) => ({ ...a, is_default: !!a.is_default })) });
});

/** Koordinat peta (null bila kosong / tidak valid). */
function coord(v, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null;
}

function saveAddress(req, id) {
  required(req.body, ['recipient', 'phone', 'address']);
  const d = db.get();
  const b = req.body;
  const isDefault = toBool(b.is_default);
  return db.transaction(() => {
    const count = d.prepare('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?').get(req.user.id).n;
    const makeDefault = isDefault || count === 0 || (id && count === 1);
    if (makeDefault) d.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
    const values = [String(b.label || 'Rumah'), String(b.recipient), normalizePhone(b.phone), String(b.address), String(b.notes || ''), coord(b.lat, 90), coord(b.lng, 180), makeDefault ? 1 : 0];
    if (id) {
      const r = d.prepare('UPDATE addresses SET label=?, recipient=?, phone=?, address=?, notes=?, lat=?, lng=?, is_default=? WHERE id=? AND user_id=?').run(...values, id, req.user.id);
      if (!r.changes) throw new HttpError(404, 'Alamat tidak ditemukan');
      return id;
    }
    return Number(d.prepare('INSERT INTO addresses (label, recipient, phone, address, notes, lat, lng, is_default, user_id) VALUES (?,?,?,?,?,?,?,?,?)').run(...values, req.user.id).lastInsertRowid);
  });
}

router.post('/addresses', (req, res) => {
  const id = saveAddress(req);
  res.status(201).json({ data: db.plain(db.get().prepare('SELECT * FROM addresses WHERE id = ?').get(id)) });
});

router.put('/addresses/:id', (req, res) => {
  const id = saveAddress(req, toInt(req.params.id));
  res.json({ data: db.plain(db.get().prepare('SELECT * FROM addresses WHERE id = ?').get(id)) });
});

router.delete('/addresses/:id', (req, res) => {
  db.get().prepare('DELETE FROM addresses WHERE id = ? AND user_id = ?').run(toInt(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ pesanan
/** Hitung ringkasan belanja sebelum checkout (subtotal, ongkir, total). */
router.post('/checkout/quote', asyncHandler(async (req, res) => {
  const s = settings.all();
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  const resolved = orders.resolveLines(items, { strict: false });
  const problems = resolved.problems;
  const lines = resolved.lines.map((l) => ({
    product_id: l.product.id,
    variant_id: l.variant?.id ?? null,
    name: l.name,
    price: l.price,
    quantity: l.quantity,
    subtotal: l.subtotal,
  }));
  const subtotal = lines.reduce((a, l) => a + l.subtotal, 0);
  const method = req.body.delivery_method === 'pickup' ? 'pickup' : 'delivery';
  const address = req.body.address_id
    ? db.plain(db.get().prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(toInt(req.body.address_id), req.user.id))
    : null;
  let ship = { fee: 0, distance_km: null, estimated: false };
  let shippingError = null;
  try {
    ship = await shipping.quote({ subtotal, method, address, settings: s });
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    shippingError = err.message;
    problems.push({ message: err.message, type: 'shipping' });
  }
  if (subtotal < s.min_order) problems.push({ message: `Minimal belanja Rp${s.min_order.toLocaleString('id-ID')}` });
  res.json({
    data: {
      lines,
      subtotal,
      delivery_fee: ship.fee,
      distance_km: ship.distance_km,
      distance_estimated: ship.estimated,
      shipping_mode: s.shipping_mode === 'distance' && s.store_lat !== null ? 'distance' : 'flat',
      shipping_error: shippingError,
      total: subtotal + ship.fee,
      free_delivery_min: s.free_delivery_min,
      problems,
    },
  });
}));

router.post(
  '/orders',
  asyncHandler(async (req, res) => {
    const o = await orders.create(req.user, req.body);
    res.status(201).json({ data: orderOut(req, o) });
  })
);

router.get('/orders', (req, res) => {
  const d = db.get();
  const rows = d
    .prepare(
      `SELECT o.*, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count,
              (SELECT name FROM order_items i WHERE i.order_id = o.id ORDER BY id LIMIT 1) AS first_item
       FROM orders o WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 100`
    )
    .all(req.user.id)
    .map(db.plain)
    .map((o) => ({ ...o, status_label: orders.STATUS_LABEL[o.status] }));
  res.json({ data: rows });
});

function ownOrder(req) {
  const o = orders.findByCode(req.params.code);
  if (!o || o.user_id !== req.user.id) throw new HttpError(404, 'Pesanan tidak ditemukan');
  return o;
}

router.get(
  '/orders/:code',
  asyncHandler(async (req, res) => {
    const o = await orders.refresh(ownOrder(req));
    res.json({ data: orderOut(req, orders.detail(o)) });
  })
);

router.post('/orders/:code/cancel', (req, res) => {
  const o = ownOrder(req);
  if (o.status !== 'pending_payment') throw new HttpError(400, 'Pesanan yang sudah dibayar tidak bisa dibatalkan sendiri. Hubungi toko.');
  res.json({ data: orderOut(req, orders.detail(orders.cancel(o.id, 'Dibatalkan oleh pembeli'))) });
});

module.exports = router;
