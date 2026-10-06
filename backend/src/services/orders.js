const db = require('../db');
const settings = require('./settings');
const payment = require('./payment');
const { HttpError, orderCode, toInt, sqlDate } = require('../utils');

const STATUS_LABEL = {
  pending_payment: 'Menunggu Pembayaran',
  paid: 'Pembayaran Diterima',
  processing: 'Sedang Disiapkan',
  shipping: 'Sedang Diantar',
  ready_pickup: 'Siap Diambil',
  completed: 'Selesai',
  cancelled: 'Dibatalkan',
};

// Transisi status yang boleh dilakukan admin
const TRANSITIONS = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['processing', 'cancelled'],
  processing: ['shipping', 'ready_pickup', 'cancelled'],
  shipping: ['completed'],
  ready_pickup: ['completed'],
  completed: [],
  cancelled: [],
};

/** Status berikutnya yang relevan untuk pesanan ini (antar vs ambil di toko). */
function nextStatuses(o) {
  const skip = o.delivery_method === 'delivery' ? 'ready_pickup' : 'shipping';
  return (TRANSITIONS[o.status] || []).filter((s) => s !== skip);
}

function addHistory(orderId, status, note = '') {
  db.get().prepare('INSERT INTO order_history (order_id, status, note) VALUES (?, ?, ?)').run(orderId, status, note);
}

function findById(id) {
  return db.plain(db.get().prepare('SELECT * FROM orders WHERE id = ?').get(id));
}

function findByCode(code) {
  return db.plain(db.get().prepare('SELECT * FROM orders WHERE code = ?').get(code));
}

function detail(order) {
  if (!order) return order;
  const d = db.get();
  const items = d.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(order.id).map(db.plain);
  const history = d.prepare('SELECT status, note, created_at FROM order_history WHERE order_id = ? ORDER BY id').all(order.id).map(db.plain);
  const customer = db.plain(d.prepare('SELECT id, name, phone, email FROM users WHERE id = ?').get(order.user_id));
  return { ...order, status_label: STATUS_LABEL[order.status], items, history, customer };
}

/**
 * Buat pesanan baru: validasi produk & stok, hitung total, kurangi stok, lalu
 * minta link pembayaran ke payment gateway.
 */
async function create(user, body) {
  const s = settings.all();
  if (!s.is_open) throw new HttpError(400, 'Maaf, toko sedang tutup');

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new HttpError(400, 'Keranjang masih kosong');

  const deliveryMethod = body.delivery_method === 'pickup' ? 'pickup' : 'delivery';
  if (deliveryMethod === 'delivery' && !s.delivery_enabled) throw new HttpError(400, 'Layanan antar sedang tidak tersedia');
  if (deliveryMethod === 'pickup' && !s.pickup_enabled) throw new HttpError(400, 'Layanan ambil di toko sedang tidak tersedia');

  const paymentMethod = body.payment_method;
  const channel = payment.validateMethod(paymentMethod, body.payment_channel);

  let recipient = String(body.recipient || user.name || '').trim();
  let phone = String(body.phone || user.phone || '').trim();
  let address = String(body.address || '').trim();
  if (body.address_id) {
    const a = db.plain(db.get().prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(body.address_id, user.id));
    if (!a) throw new HttpError(400, 'Alamat tidak ditemukan');
    recipient = a.recipient;
    phone = a.phone;
    address = a.address + (a.notes ? ` (${a.notes})` : '');
  }
  if (deliveryMethod === 'delivery' && !address) throw new HttpError(400, 'Alamat pengiriman wajib diisi');
  if (!phone) throw new HttpError(400, 'Nomor HP wajib diisi');

  const order = db.transaction((d) => {
    const getProduct = d.prepare('SELECT * FROM products WHERE id = ?');
    const lines = [];
    const seen = new Map();
    for (const it of items) {
      const qty = toInt(it.quantity);
      if (qty <= 0) throw new HttpError(400, 'Jumlah produk tidak valid');
      const pid = toInt(it.product_id);
      seen.set(pid, (seen.get(pid) || 0) + qty);
    }
    for (const [pid, qty] of seen) {
      const p = db.plain(getProduct.get(pid));
      if (!p || !p.is_active) throw new HttpError(400, 'Ada produk yang sudah tidak tersedia');
      if (p.stock < qty) throw new HttpError(400, `Stok ${p.name} tinggal ${p.stock} ${p.unit}`);
      lines.push({ product: p, quantity: qty, subtotal: p.price * qty });
    }

    const subtotal = lines.reduce((a, l) => a + l.subtotal, 0);
    if (subtotal < s.min_order) throw new HttpError(400, `Minimal belanja Rp${s.min_order.toLocaleString('id-ID')}`);
    const fee = settings.deliveryFee(subtotal, deliveryMethod, s);
    const total = subtotal + fee;

    const res = d
      .prepare(
        `INSERT INTO orders (code, user_id, delivery_method, recipient, phone, address, notes, subtotal, delivery_fee, total, payment_method, payment_channel)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(orderCode(), user.id, deliveryMethod, recipient, phone, deliveryMethod === 'delivery' ? address : '', String(body.notes || ''), subtotal, fee, total, paymentMethod, channel);
    const orderId = Number(res.lastInsertRowid);

    const insItem = d.prepare(
      'INSERT INTO order_items (order_id, product_id, name, unit, image_url, price, quantity, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const decStock = d.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    for (const l of lines) {
      insItem.run(orderId, l.product.id, l.product.name, l.product.unit, l.product.image_url, l.product.price, l.quantity, l.subtotal);
      decStock.run(l.quantity, l.product.id);
    }
    addHistory(orderId, 'pending_payment', 'Pesanan dibuat');
    return findById(orderId);
  });

  try {
    const items = db.get().prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id).map(db.plain);
    const p = await payment.provider().create(order, { items, customer: user, expiryMinutes: s.payment_expiry_minutes });
    db.get()
      .prepare('UPDATE orders SET payment_provider = ?, payment_ref = ?, payment_url = ?, payment_expires_at = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(p.provider, p.ref, p.url, p.expires_at, order.id);
  } catch (err) {
    cancel(order.id, 'Gagal membuat pembayaran');
    throw err;
  }
  return detail(findById(order.id));
}

function restoreStock(orderId) {
  const d = db.get();
  const items = d.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(orderId);
  const inc = d.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
  for (const i of items) if (i.product_id) inc.run(i.quantity, i.product_id);
}

function cancel(orderId, note = 'Pesanan dibatalkan', paymentStatus) {
  return db.transaction((d) => {
    const o = findById(orderId);
    if (!o || o.status === 'cancelled' || o.status === 'completed') return o;
    restoreStock(orderId);
    d.prepare(
      `UPDATE orders SET status = 'cancelled', payment_status = COALESCE(?, payment_status), updated_at = datetime('now') WHERE id = ?`
    ).run(paymentStatus ?? null, orderId);
    addHistory(orderId, 'cancelled', note);
    return findById(orderId);
  });
}

function markPaid(orderId, ref, note = 'Pembayaran berhasil') {
  const o = findById(orderId);
  if (!o) throw new HttpError(404, 'Pesanan tidak ditemukan');
  if (o.payment_status === 'paid') return o;
  if (o.status === 'cancelled') {
    // Pembayaran masuk setelah dibatalkan/kedaluwarsa: tetap dicatat agar admin bisa refund.
    db.get().prepare(`UPDATE orders SET payment_status = 'paid', paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(orderId);
    addHistory(orderId, 'cancelled', 'Pembayaran diterima setelah pesanan dibatalkan — perlu refund');
    return findById(orderId);
  }
  db.get()
    .prepare(
      `UPDATE orders SET status = 'paid', payment_status = 'paid', paid_at = datetime('now'),
       payment_ref = CASE WHEN ? <> '' THEN ? ELSE payment_ref END, updated_at = datetime('now') WHERE id = ?`
    )
    .run(ref || '', ref || '', orderId);
  addHistory(orderId, 'paid', note);
  return findById(orderId);
}

/** Terapkan hasil dari payment gateway (webhook / cek status). */
function applyPaymentState(order, result) {
  if (!result) return order;
  switch (result.state) {
    case 'paid':
      return markPaid(order.id, result.ref);
    case 'expired':
      return order.status === 'pending_payment' ? cancel(order.id, 'Waktu pembayaran habis', 'expired') : order;
    case 'failed':
      return order.status === 'pending_payment' ? cancel(order.id, 'Pembayaran gagal', 'failed') : order;
    case 'refunded':
      db.get().prepare(`UPDATE orders SET payment_status = 'refunded', updated_at = datetime('now') WHERE id = ?`).run(order.id);
      return findById(order.id);
    default:
      return order;
  }
}

/** Sinkronkan pesanan yang masih menunggu bayar dengan gateway + cek kedaluwarsa. */
async function refresh(order) {
  if (!order || order.status !== 'pending_payment') return order;
  try {
    const result = await payment.provider(order.payment_provider).status(order);
    order = applyPaymentState(order, result);
  } catch (err) {
    console.warn('[payment] gagal cek status', order.code, err.message);
  }
  if (order.status === 'pending_payment' && order.payment_expires_at && order.payment_expires_at < sqlDate()) {
    order = cancel(order.id, 'Waktu pembayaran habis', 'expired');
  }
  return order;
}

function expireOverdue() {
  const rows = db
    .get()
    .prepare(`SELECT id FROM orders WHERE status = 'pending_payment' AND payment_provider = 'simulator' AND payment_expires_at < ?`)
    .all(sqlDate());
  for (const r of rows) cancel(r.id, 'Waktu pembayaran habis', 'expired');
  return rows.length;
}

function updateStatus(orderId, status, note = '') {
  const o = findById(orderId);
  if (!o) throw new HttpError(404, 'Pesanan tidak ditemukan');
  if (!TRANSITIONS[o.status]?.includes(status)) {
    throw new HttpError(400, `Status tidak bisa diubah dari "${STATUS_LABEL[o.status]}" ke "${STATUS_LABEL[status] || status}"`);
  }
  if (status === 'paid') return markPaid(orderId, '', note || 'Dikonfirmasi manual oleh admin');
  if (status === 'cancelled') return cancel(orderId, note || 'Dibatalkan oleh admin');
  if (status === 'shipping' && o.delivery_method !== 'delivery') throw new HttpError(400, 'Pesanan ini diambil di toko');
  if (status === 'ready_pickup' && o.delivery_method !== 'pickup') throw new HttpError(400, 'Pesanan ini diantar');
  db.get().prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, orderId);
  addHistory(orderId, status, note);
  return findById(orderId);
}

module.exports = {
  STATUS_LABEL,
  TRANSITIONS,
  nextStatuses,
  create,
  detail,
  findById,
  findByCode,
  cancel,
  markPaid,
  applyPaymentState,
  refresh,
  expireOverdue,
  updateStatus,
};
