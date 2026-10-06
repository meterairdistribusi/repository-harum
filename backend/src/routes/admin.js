const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const orders = require('../services/orders');
const settings = require('../services/settings');
const config = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { HttpError, required, toInt, toBool, slugify } = require('../utils');
const { absUrl, upload } = require('../media');

const router = express.Router();
router.use(authenticate, requireAdmin);

// ------------------------------------------------------------------ dashboard
router.get('/stats', (req, res) => {
  const d = db.get();
  const one = (sql, ...p) => db.plain(d.prepare(sql).get(...p));
  const paidStatuses = `('paid','processing','shipping','ready_pickup','completed')`;
  const today = one(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders
     WHERE status IN ${paidStatuses} AND date(created_at, 'localtime') = date('now', 'localtime')`
  );
  const month = one(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders
     WHERE status IN ${paidStatuses} AND strftime('%Y-%m', created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')`
  );
  const byStatus = Object.fromEntries(d.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all().map((r) => [r.status, r.n]));
  const daily = d
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders
       WHERE status IN ${paidStatuses} AND date(created_at, 'localtime') >= date('now', 'localtime', '-6 days')
       GROUP BY day ORDER BY day`
    )
    .all()
    .map(db.plain);
  const topProducts = d
    .prepare(
      `SELECT i.name, SUM(i.quantity) AS qty, SUM(i.subtotal) AS revenue FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.status IN ${paidStatuses} GROUP BY i.name ORDER BY qty DESC LIMIT 5`
    )
    .all()
    .map(db.plain);
  const byCategory = d
    .prepare(
      `SELECT c.name, c.icon, COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN i.subtotal END),0) AS revenue FROM categories c
       LEFT JOIN products p ON p.category_id = c.id
       LEFT JOIN order_items i ON i.product_id = p.id
       LEFT JOIN orders o ON o.id = i.order_id AND o.status IN ${paidStatuses}
       GROUP BY c.id ORDER BY c.sort_order`
    )
    .all()
    .map(db.plain);
  const lowStock = d.prepare('SELECT id, name, stock, unit FROM products WHERE is_active = 1 AND stock <= 10 ORDER BY stock LIMIT 10').all().map(db.plain);
  const customers = one(`SELECT COUNT(*) AS n FROM users WHERE role = 'customer'`).n;
  res.json({ data: { today, month, byStatus, daily, topProducts, byCategory, lowStock, customers, paymentProvider: config.payment.provider } });
});

// ------------------------------------------------------------------ pesanan
router.get('/orders', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.status) {
    where.push('o.status = ?');
    params.push(String(req.query.status));
  }
  if (req.query.q) {
    where.push('(o.code LIKE ? OR o.recipient LIKE ? OR o.phone LIKE ? OR u.name LIKE ?)');
    const q = `%${req.query.q}%`;
    params.push(q, q, q, q);
  }
  const limit = Math.min(toInt(req.query.limit, 50), 200);
  const offset = toInt(req.query.offset, 0);
  const sqlWhere = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const d = db.get();
  const total = d.prepare(`SELECT COUNT(*) AS n FROM orders o JOIN users u ON u.id = o.user_id ${sqlWhere}`).get(...params).n;
  const rows = d
    .prepare(
      `SELECT o.*, u.name AS customer_name, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
       FROM orders o JOIN users u ON u.id = o.user_id ${sqlWhere} ORDER BY o.id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)
    .map(db.plain)
    .map((o) => ({ ...o, status_label: orders.STATUS_LABEL[o.status], next_statuses: orders.nextStatuses(o) }));
  res.json({ data: rows, total });
});

router.get('/orders/:id', (req, res) => {
  const o = orders.findById(toInt(req.params.id));
  if (!o) throw new HttpError(404, 'Pesanan tidak ditemukan');
  const det = orders.detail(o);
  res.json({ data: { ...det, next_statuses: orders.nextStatuses(o), items: det.items.map((i) => ({ ...i, image_url: absUrl(req, i.image_url) })) } });
});

router.post('/orders/:id/status', (req, res) => {
  required(req.body, ['status']);
  const o = orders.updateStatus(toInt(req.params.id), String(req.body.status), String(req.body.note || ''));
  res.json({ data: { ...orders.detail(o), next_statuses: orders.nextStatuses(o) } });
});

router.get('/status-labels', (_req, res) => res.json({ data: orders.STATUS_LABEL }));

// ------------------------------------------------------------------ kategori
router.get('/categories', (_req, res) => {
  res.json({
    data: db
      .get()
      .prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY sort_order, id')
      .all()
      .map(db.plain),
  });
});

function categoryValues(b) {
  required(b, ['name']);
  return [String(b.name).trim(), slugify(b.slug || b.name), String(b.icon || '🧊'), String(b.color || '#E0F2FE'), String(b.description || ''), toInt(b.sort_order)];
}

router.post('/categories', (req, res) => {
  const r = db.get().prepare('INSERT INTO categories (name, slug, icon, color, description, sort_order) VALUES (?,?,?,?,?,?)').run(...categoryValues(req.body));
  res.status(201).json({ data: db.plain(db.get().prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid)) });
});

router.put('/categories/:id', (req, res) => {
  const id = toInt(req.params.id);
  db.get().prepare('UPDATE categories SET name=?, slug=?, icon=?, color=?, description=?, sort_order=? WHERE id=?').run(...categoryValues(req.body), id);
  res.json({ data: db.plain(db.get().prepare('SELECT * FROM categories WHERE id = ?').get(id)) });
});

router.delete('/categories/:id', (req, res) => {
  const id = toInt(req.params.id);
  if (db.get().prepare('SELECT 1 FROM products WHERE category_id = ?').get(id)) throw new HttpError(400, 'Kategori masih berisi produk. Pindahkan/hapus produknya dulu.');
  db.get().prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ produk
router.get('/products', (req, res) => {
  const rows = db
    .get()
    .prepare('SELECT p.*, c.name AS category_name, c.icon AS category_icon FROM products p JOIN categories c ON c.id = p.category_id ORDER BY c.sort_order, p.name')
    .all()
    .map(db.plain)
    .map((p) => ({ ...p, image_path: p.image_url, image_url: absUrl(req, p.image_url) }));
  res.json({ data: rows });
});

function productValues(req, existing) {
  const b = req.body;
  required(b, ['name', 'category_id', 'price']);
  let image = existing?.image_url ?? '';
  if (req.file) image = '/uploads/' + req.file.filename;
  else if (b.remove_image === '1' || b.remove_image === true) image = '';
  else if (b.image_url !== undefined && /^https?:\/\//.test(b.image_url)) image = b.image_url;
  if (existing && image !== existing.image_url) removeUpload(existing.image_url);
  return [
    toInt(b.category_id),
    String(b.name).trim(),
    String(b.description || ''),
    Math.max(0, toInt(b.price)),
    String(b.unit || 'pcs'),
    image,
    Math.max(0, toInt(b.stock)),
    b.is_active === undefined ? 1 : toBool(b.is_active),
    toBool(b.is_featured),
  ];
}

function removeUpload(url) {
  if (url && url.startsWith('/uploads/')) fs.rm(path.join(config.uploadDir, path.basename(url)), { force: true }, () => {});
}

router.post('/products', upload.single('image'), (req, res) => {
  const r = db
    .get()
    .prepare('INSERT INTO products (category_id, name, description, price, unit, image_url, stock, is_active, is_featured) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(...productValues(req));
  res.status(201).json({ data: db.plain(db.get().prepare('SELECT * FROM products WHERE id = ?').get(r.lastInsertRowid)) });
});

router.put('/products/:id', upload.single('image'), (req, res) => {
  const id = toInt(req.params.id);
  const existing = db.plain(db.get().prepare('SELECT * FROM products WHERE id = ?').get(id));
  if (!existing) throw new HttpError(404, 'Produk tidak ditemukan');
  db.get()
    .prepare('UPDATE products SET category_id=?, name=?, description=?, price=?, unit=?, image_url=?, stock=?, is_active=?, is_featured=? WHERE id=?')
    .run(...productValues(req, existing), id);
  res.json({ data: db.plain(db.get().prepare('SELECT * FROM products WHERE id = ?').get(id)) });
});

router.patch('/products/:id/stock', (req, res) => {
  const id = toInt(req.params.id);
  db.get().prepare('UPDATE products SET stock = MAX(0, ?) WHERE id = ?').run(toInt(req.body.stock), id);
  res.json({ data: db.plain(db.get().prepare('SELECT * FROM products WHERE id = ?').get(id)) });
});

router.delete('/products/:id', (req, res) => {
  const id = toInt(req.params.id);
  const p = db.plain(db.get().prepare('SELECT * FROM products WHERE id = ?').get(id));
  if (!p) throw new HttpError(404, 'Produk tidak ditemukan');
  db.get().prepare('DELETE FROM products WHERE id = ?').run(id);
  removeUpload(p.image_url);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ banner promo
router.get('/banners', (req, res) => {
  res.json({ data: db.get().prepare('SELECT * FROM banners ORDER BY sort_order, id').all().map(db.plain).map((b) => ({ ...b, image_url: absUrl(req, b.image_url) })) });
});

function bannerValues(req, existing) {
  const b = req.body;
  required(b, ['title']);
  let image = existing?.image_url ?? '';
  if (req.file) image = '/uploads/' + req.file.filename;
  else if (b.remove_image === '1') image = '';
  if (existing && image !== existing.image_url) removeUpload(existing.image_url);
  return [String(b.title), String(b.subtitle || ''), image, String(b.color || '#0EA5E9'), b.is_active === undefined ? 1 : toBool(b.is_active), toInt(b.sort_order)];
}

router.post('/banners', upload.single('image'), (req, res) => {
  const r = db.get().prepare('INSERT INTO banners (title, subtitle, image_url, color, is_active, sort_order) VALUES (?,?,?,?,?,?)').run(...bannerValues(req));
  res.status(201).json({ data: db.plain(db.get().prepare('SELECT * FROM banners WHERE id = ?').get(r.lastInsertRowid)) });
});

router.put('/banners/:id', upload.single('image'), (req, res) => {
  const id = toInt(req.params.id);
  const existing = db.plain(db.get().prepare('SELECT * FROM banners WHERE id = ?').get(id));
  if (!existing) throw new HttpError(404, 'Banner tidak ditemukan');
  db.get().prepare('UPDATE banners SET title=?, subtitle=?, image_url=?, color=?, is_active=?, sort_order=? WHERE id=?').run(...bannerValues(req, existing), id);
  res.json({ data: db.plain(db.get().prepare('SELECT * FROM banners WHERE id = ?').get(id)) });
});

router.delete('/banners/:id', (req, res) => {
  const id = toInt(req.params.id);
  const b = db.plain(db.get().prepare('SELECT * FROM banners WHERE id = ?').get(id));
  db.get().prepare('DELETE FROM banners WHERE id = ?').run(id);
  removeUpload(b?.image_url);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ pelanggan
router.get('/customers', (req, res) => {
  const q = req.query.q ? `%${req.query.q}%` : '%';
  const rows = db
    .get()
    .prepare(
      `SELECT u.id, u.name, u.phone, u.email, u.created_at,
              COUNT(o.id) AS order_count,
              COALESCE(SUM(CASE WHEN o.payment_status = 'paid' AND o.status <> 'cancelled' THEN o.total END), 0) AS total_spent,
              MAX(o.created_at) AS last_order_at
       FROM users u LEFT JOIN orders o ON o.user_id = u.id
       WHERE u.role = 'customer' AND (u.name LIKE ? OR IFNULL(u.phone,'') LIKE ? OR IFNULL(u.email,'') LIKE ?)
       GROUP BY u.id ORDER BY u.id DESC LIMIT 500`
    )
    .all(q, q, q)
    .map(db.plain);
  res.json({ data: rows });
});

// ------------------------------------------------------------------ pengaturan
router.get('/settings', (_req, res) => res.json({ data: settings.all() }));
router.put('/settings', (req, res) => res.json({ data: settings.update(req.body || {}) }));

module.exports = router;
