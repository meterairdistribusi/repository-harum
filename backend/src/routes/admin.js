const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const orders = require('../services/orders');
const settings = require('../services/settings');
const shipping = require('../services/shipping');
const catalog = require('../services/catalog');
const realtime = require('../realtime');
const config = require('../config');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { HttpError, required, toInt, toBool, slugify } = require('../utils');
const { absUrl, upload } = require('../media');

const router = express.Router();
router.use(authenticate, requireAdmin, realtime.adminChanges);

// ------------------------------------------------------------------ dashboard
// Status pesanan yang dihitung sebagai penjualan (termasuk pesanan tunai yang sedang diproses)
const SALE = `('paid','processing','shipping','ready_pickup','completed')`;

/**
 * Ringkasan keuangan satu periode.
 *  omzet (revenue)     = penjualan produk (tanpa ongkir)
 *  modal (cost)        = harga modal x qty
 *  laba kotor          = omzet - modal
 *  biaya operasional   = total pengeluaran (gaji, listrik, sewa, ...) pada periode tsb.
 *  laba bersih (profit)= laba kotor - biaya operasional
 *  margin_on_cost      = laba bersih / (modal + biaya operasional)
 */
function salesSummary(period, ...params) {
  const r = db.plain(
    db
      .get()
      .prepare(
        `SELECT COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(i.subtotal),0) AS revenue, COALESCE(SUM(i.cost_price * i.quantity),0) AS cost
         FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.status IN ${SALE} AND ${period.orders}`
      )
      .get(...params)
  );
  const expenses = db.get().prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM expenses WHERE ${period.expenses}`).get(...params).n;
  const gross = r.revenue - r.cost;
  const spent = r.cost + expenses;
  return { ...r, gross_profit: gross, expenses, profit: gross - expenses, margin_on_cost: spent > 0 ? (gross - expenses) / spent : null };
}

const PERIOD = {
  today: { orders: `date(o.created_at, 'localtime') = date('now', 'localtime')`, expenses: `date = date('now', 'localtime')` },
  month: { orders: `strftime('%Y-%m', o.created_at, 'localtime') = strftime('%Y-%m', 'now', 'localtime')`, expenses: `substr(date, 1, 7) = strftime('%Y-%m', 'now', 'localtime')` },
  year: { orders: `strftime('%Y', o.created_at, 'localtime') = ?`, expenses: `substr(date, 1, 4) = ?` },
  all: { orders: '1 = 1', expenses: '1 = 1' },
};

router.get('/stats', (req, res) => {
  const d = db.get();
  const one = (sql, ...p) => db.plain(d.prepare(sql).get(...p));
  const thisYear = String(new Date().getFullYear());
  const year = /^\d{4}$/.test(String(req.query.year)) ? String(req.query.year) : thisYear;

  const today = salesSummary(PERIOD.today);
  const month = salesSummary(PERIOD.month);
  const yearSum = salesSummary(PERIOD.year, year);
  const allTime = salesSummary(PERIOD.all);

  // Grafik garis: omzet, modal & profit per bulan dalam satu tahun
  const rows = d
    .prepare(
      `SELECT CAST(strftime('%m', o.created_at, 'localtime') AS INTEGER) AS m, COUNT(DISTINCT o.id) AS orders,
              COALESCE(SUM(i.subtotal),0) AS revenue, COALESCE(SUM(i.cost_price * i.quantity),0) AS cost
       FROM orders o JOIN order_items i ON i.order_id = o.id
       WHERE o.status IN ${SALE} AND strftime('%Y', o.created_at, 'localtime') = ?
       GROUP BY m`
    )
    .all(year)
    .map(db.plain);
  const expenseRows = d
    .prepare(`SELECT CAST(substr(date, 6, 2) AS INTEGER) AS m, SUM(amount) AS total FROM expenses WHERE substr(date, 1, 4) = ? GROUP BY m`)
    .all(year)
    .map(db.plain);
  const monthly = Array.from({ length: 12 }, (_, k) => {
    const r = rows.find((x) => x.m === k + 1) || { orders: 0, revenue: 0, cost: 0 };
    const expenses = expenseRows.find((x) => x.m === k + 1)?.total || 0;
    const gross = r.revenue - r.cost;
    return { month: k + 1, orders: r.orders, revenue: r.revenue, cost: r.cost, gross_profit: gross, expenses, profit: gross - expenses };
  });
  const years = d
    .prepare(`SELECT DISTINCT strftime('%Y', created_at, 'localtime') AS y FROM orders ORDER BY y DESC`)
    .all()
    .map((r) => r.y);
  if (!years.includes(thisYear)) years.unshift(thisYear);

  const byStatus = Object.fromEntries(d.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all().map((r) => [r.status, r.n]));
  const daily = d
    .prepare(
      `SELECT date(o.created_at, 'localtime') AS day, COUNT(DISTINCT o.id) AS orders, COALESCE(SUM(i.subtotal),0) AS revenue
       FROM orders o JOIN order_items i ON i.order_id = o.id
       WHERE o.status IN ${SALE} AND date(o.created_at, 'localtime') >= date('now', 'localtime', '-6 days')
       GROUP BY day ORDER BY day`
    )
    .all()
    .map(db.plain);
  const topProducts = d
    .prepare(
      `SELECT i.name, SUM(i.quantity) AS qty, SUM(i.subtotal) AS revenue, SUM(i.subtotal - i.cost_price * i.quantity) AS profit
       FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE o.status IN ${SALE} GROUP BY i.name ORDER BY qty DESC LIMIT 5`
    )
    .all()
    .map(db.plain);
  const byCategory = d
    .prepare(
      `SELECT c.name, c.icon, COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN i.subtotal END),0) AS revenue FROM categories c
       LEFT JOIN products p ON p.category_id = c.id
       LEFT JOIN order_items i ON i.product_id = p.id
       LEFT JOIN orders o ON o.id = i.order_id AND o.status IN ${SALE}
       GROUP BY c.id ORDER BY c.sort_order`
    )
    .all()
    .map(db.plain);
  const lowStock = d.prepare('SELECT id, name, stock, unit FROM products WHERE is_active = 1 AND stock <= 10 ORDER BY stock LIMIT 10').all().map(db.plain);
  const missingCost =
    one(`SELECT COUNT(*) AS n FROM products p WHERE p.is_active = 1 AND p.cost_price = 0 AND NOT EXISTS (SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1)`).n +
    one(`SELECT COUNT(*) AS n FROM product_variants v JOIN products p ON p.id = v.product_id WHERE p.is_active = 1 AND v.is_active = 1 AND v.cost_price = 0`).n;
  const customers = one(`SELECT COUNT(*) AS n FROM users WHERE role = 'customer'`).n;
  res.json({
    data: {
      today,
      month,
      year: { year: Number(year), ...yearSum },
      allTime,
      monthly,
      years,
      byStatus,
      daily,
      topProducts,
      byCategory,
      lowStock,
      missingCost,
      customers,
      paymentProvider: config.payment.provider,
    },
  });
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

/** Hapus file upload lama yang sudah tidak dipakai. */
function removeUpload(url) {
  if (url && url.startsWith('/uploads/')) fs.rm(path.join(config.uploadDir, path.basename(url)), { force: true }, () => {});
}

// ------------------------------------------------------------------ kategori
router.get('/categories', (req, res) => {
  res.json({
    data: db
      .get()
      .prepare('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count FROM categories c ORDER BY sort_order, id')
      .all()
      .map(db.plain)
      .map((c) => ({ ...c, image_path: c.image_url, image_url: absUrl(req, c.image_url) })),
  });
});

/** Gambar kategori: maksimal 1 (menggantikan ikon emoji di aplikasi). */
function categoryValues(req, existing) {
  const b = req.body;
  required(b, ['name']);
  let image = existing?.image_url ?? '';
  if (req.file) image = '/uploads/' + req.file.filename;
  else if (b.remove_image === '1' || b.remove_image === true) image = '';
  if (existing && image !== existing.image_url) removeUpload(existing.image_url);
  return [String(b.name).trim(), slugify(b.slug || b.name), String(b.icon || '🧊'), String(b.color || '#E0F2FE'), image, String(b.description || ''), toInt(b.sort_order)];
}

router.post('/categories', upload.single('image'), (req, res) => {
  const r = db.get().prepare('INSERT INTO categories (name, slug, icon, color, image_url, description, sort_order) VALUES (?,?,?,?,?,?,?)').run(...categoryValues(req));
  res.status(201).json({ data: db.plain(db.get().prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid)) });
});

router.put('/categories/:id', upload.single('image'), (req, res) => {
  const id = toInt(req.params.id);
  const existing = db.plain(db.get().prepare('SELECT * FROM categories WHERE id = ?').get(id));
  if (!existing) throw new HttpError(404, 'Kategori tidak ditemukan');
  db.get().prepare('UPDATE categories SET name=?, slug=?, icon=?, color=?, image_url=?, description=?, sort_order=? WHERE id=?').run(...categoryValues(req, existing), id);
  res.json({ data: db.plain(db.get().prepare('SELECT * FROM categories WHERE id = ?').get(id)) });
});

router.delete('/categories/:id', (req, res) => {
  const id = toInt(req.params.id);
  if (db.get().prepare('SELECT 1 FROM products WHERE category_id = ?').get(id)) throw new HttpError(400, 'Kategori masih berisi sub menu. Pindahkan/hapus dulu.');
  const c = db.plain(db.get().prepare('SELECT * FROM categories WHERE id = ?').get(id));
  db.get().prepare('DELETE FROM categories WHERE id = ?').run(id);
  removeUpload(c?.image_url);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ sub menu (produk)
function adminProducts(req, where = '1 = 1', ...params) {
  const rows = db
    .get()
    .prepare(
      `SELECT p.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color, c.image_url AS category_image
       FROM products p JOIN categories c ON c.id = p.category_id WHERE ${where} ORDER BY c.sort_order, p.name`
    )
    .all(...params)
    .map(db.plain);
  const vmap = catalog.variantsFor(rows.map((p) => p.id), { includeInactive: true });
  return rows.map((p) => catalog.shape(req, p, vmap.get(p.id) || [], { admin: true }));
}

router.get('/products', (req, res) => res.json({ data: adminProducts(req) }));

function parseJson(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    throw new HttpError(400, 'Format data tidak valid');
  }
}

/**
 * Foto sub menu: maksimal 4. `keep_images` = daftar path lama yang dipertahankan (urutan = urutan tampil),
 * file baru (field "images") ditambahkan di belakang.
 */
function productImages(req, existing) {
  const old = existing ? catalog.parseImages(existing) : [];
  const uploaded = (req.files || []).map((f) => '/uploads/' + f.filename);
  let all;
  const order = parseJson(req.body.image_order, null);
  if (Array.isArray(order)) {
    // Urutan lengkap: "old:<path>" untuk foto lama, "new:<n>" untuk file upload ke-n
    all = order
      .map((t) => (String(t).startsWith('new:') ? uploaded[toInt(String(t).slice(4), -1)] : String(t).slice(4)))
      .filter((u, i, arr) => u && (uploaded.includes(u) || old.includes(u)) && arr.indexOf(u) === i);
    for (const u of uploaded) if (!all.includes(u)) all.push(u);
  } else {
    const keep = parseJson(req.body.keep_images, old).filter((u) => old.includes(u));
    all = [...keep, ...uploaded];
  }
  if (all.length > catalog.MAX_IMAGES) {
    uploaded.forEach(removeUpload);
    throw new HttpError(400, `Maksimal ${catalog.MAX_IMAGES} foto per sub menu`);
  }
  for (const u of old) if (!all.includes(u)) removeUpload(u);
  return all;
}

function productValues(req, images) {
  const b = req.body;
  required(b, ['name', 'category_id']);
  return [
    toInt(b.category_id),
    String(b.name).trim(),
    String(b.description || ''),
    Math.max(0, toInt(b.price)),
    Math.max(0, toInt(b.cost_price)),
    String(b.unit || 'pcs'),
    images[0] || '',
    JSON.stringify(images),
    String(b.option_label || '').trim(),
    Math.max(0, toInt(b.stock)),
    b.is_active === undefined ? 1 : toBool(b.is_active),
    toBool(b.is_featured),
  ];
}

/** Simpan pilihan: yang punya id diperbarui, yang baru ditambah, yang tidak dikirim dihapus. */
function saveVariants(productId, list) {
  if (!Array.isArray(list)) return;
  const d = db.get();
  const keepIds = [];
  list.forEach((v, i) => {
    if (!String(v.name || '').trim()) throw new HttpError(400, 'Nama pilihan wajib diisi');
    const vals = [String(v.name).trim(), Math.max(0, toInt(v.price)), Math.max(0, toInt(v.cost_price)), Math.max(0, toInt(v.stock)), v.is_active === false || v.is_active === 0 ? 0 : 1, i];
    const id = toInt(v.id);
    if (id && d.prepare('SELECT 1 FROM product_variants WHERE id = ? AND product_id = ?').get(id, productId)) {
      d.prepare('UPDATE product_variants SET name=?, price=?, cost_price=?, stock=?, is_active=?, sort_order=? WHERE id=?').run(...vals, id);
      keepIds.push(id);
    } else {
      keepIds.push(Number(d.prepare('INSERT INTO product_variants (name, price, cost_price, stock, is_active, sort_order, product_id) VALUES (?,?,?,?,?,?,?)').run(...vals, productId).lastInsertRowid));
    }
  });
  const existing = d.prepare('SELECT id FROM product_variants WHERE product_id = ?').all(productId).map((r) => r.id);
  for (const id of existing) if (!keepIds.includes(id)) d.prepare('DELETE FROM product_variants WHERE id = ?').run(id);
}

const COLS = 'category_id, name, description, price, cost_price, unit, image_url, images, option_label, stock, is_active, is_featured';

router.post('/products', upload.array('images', catalog.MAX_IMAGES), (req, res) => {
  const images = productImages(req, null);
  const variants = parseJson(req.body.variants, []);
  const id = db.transaction((d) => {
    const pid = Number(d.prepare(`INSERT INTO products (${COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(...productValues(req, images)).lastInsertRowid);
    saveVariants(pid, variants);
    return pid;
  });
  res.status(201).json({ data: adminProducts(req, 'p.id = ?', id)[0] });
});

router.put('/products/:id', upload.array('images', catalog.MAX_IMAGES), (req, res) => {
  const id = toInt(req.params.id);
  const existing = db.plain(db.get().prepare('SELECT * FROM products WHERE id = ?').get(id));
  if (!existing) throw new HttpError(404, 'Produk tidak ditemukan');
  const images = productImages(req, existing);
  const variants = parseJson(req.body.variants, undefined);
  db.transaction((d) => {
    d.prepare(`UPDATE products SET ${COLS.split(', ').map((c) => c + '=?').join(', ')} WHERE id=?`).run(...productValues(req, images), id);
    saveVariants(id, variants);
  });
  res.json({ data: adminProducts(req, 'p.id = ?', id)[0] });
});

router.patch('/products/:id/stock', (req, res) => {
  const id = toInt(req.params.id);
  db.get().prepare('UPDATE products SET stock = MAX(0, ?) WHERE id = ?').run(toInt(req.body.stock), id);
  res.json({ data: adminProducts(req, 'p.id = ?', id)[0] });
});

router.patch('/variants/:id/stock', (req, res) => {
  const id = toInt(req.params.id);
  const r = db.get().prepare('UPDATE product_variants SET stock = MAX(0, ?) WHERE id = ?').run(toInt(req.body.stock), id);
  if (!r.changes) throw new HttpError(404, 'Pilihan tidak ditemukan');
  res.json({ ok: true });
});

router.delete('/products/:id', (req, res) => {
  const id = toInt(req.params.id);
  const p = db.plain(db.get().prepare('SELECT * FROM products WHERE id = ?').get(id));
  if (!p) throw new HttpError(404, 'Produk tidak ditemukan');
  db.get().prepare('DELETE FROM products WHERE id = ?').run(id);
  catalog.parseImages(p).forEach(removeUpload);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ biaya operasional
const EXPENSE_CATEGORIES = ['Gaji karyawan', 'Listrik & air', 'Sewa tempat', 'Bensin & transport', 'Kemasan & plastik', 'Perawatan mesin', 'Internet & pulsa', 'Pemasaran', 'Lainnya'];

router.get('/expenses', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.query.month)) ? String(req.query.month) : new Date().toISOString().slice(0, 7);
  const rows = db.get().prepare(`SELECT * FROM expenses WHERE substr(date, 1, 7) = ? ORDER BY date DESC, id DESC`).all(month).map(db.plain);
  const byCategory = db
    .get()
    .prepare(`SELECT category, SUM(amount) AS total FROM expenses WHERE substr(date, 1, 7) = ? GROUP BY category ORDER BY total DESC`)
    .all(month)
    .map(db.plain);
  res.json({ data: rows, month, total: rows.reduce((a, r) => a + r.amount, 0), byCategory, categories: EXPENSE_CATEGORIES });
});

function expenseValues(b) {
  required(b, ['date', 'category', 'amount']);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) throw new HttpError(400, 'Tanggal tidak valid');
  const amount = toInt(b.amount, -1);
  if (amount < 0) throw new HttpError(400, 'Nominal tidak valid');
  return [String(b.date), String(b.category).trim(), String(b.description || '').trim(), amount];
}

router.post('/expenses', (req, res) => {
  const r = db.get().prepare('INSERT INTO expenses (date, category, description, amount) VALUES (?,?,?,?)').run(...expenseValues(req.body));
  res.status(201).json({ data: db.plain(db.get().prepare('SELECT * FROM expenses WHERE id = ?').get(r.lastInsertRowid)) });
});

router.put('/expenses/:id', (req, res) => {
  const id = toInt(req.params.id);
  const r = db.get().prepare('UPDATE expenses SET date=?, category=?, description=?, amount=? WHERE id=?').run(...expenseValues(req.body), id);
  if (!r.changes) throw new HttpError(404, 'Data biaya tidak ditemukan');
  res.json({ data: db.plain(db.get().prepare('SELECT * FROM expenses WHERE id = ?').get(id)) });
});

router.delete('/expenses/:id', (req, res) => {
  db.get().prepare('DELETE FROM expenses WHERE id = ?').run(toInt(req.params.id));
  res.json({ ok: true });
});

/** Salin semua biaya bulan sebelumnya ke bulan ini (untuk biaya rutin seperti gaji & sewa). */
router.post('/expenses/copy-previous', (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(String(req.body.month)) ? String(req.body.month) : new Date().toISOString().slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const rows = db.get().prepare('SELECT * FROM expenses WHERE substr(date, 1, 7) = ?').all(prev).map(db.plain);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ins = db.get().prepare('INSERT INTO expenses (date, category, description, amount) VALUES (?,?,?,?)');
  db.transaction(() => {
    for (const r of rows) ins.run(`${month}-${String(Math.min(Number(r.date.slice(8)), lastDay)).padStart(2, '0')}`, r.category, r.description, r.amount);
  });
  res.json({ copied: rows.length, from: prev });
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

/** Simulasi ongkir dari lokasi toko ke titik tertentu (dipakai di halaman pengaturan). */
router.get('/shipping/preview', async (req, res) => {
  const s = { ...settings.all() };
  for (const k of ['shipping_base_fee', 'shipping_base_km', 'shipping_per_km', 'shipping_max_km', 'store_lat', 'store_lng']) {
    if (req.query[k] !== undefined && req.query[k] !== '') s[k] = Number(req.query[k]);
  }
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || s.store_lat === null) throw new HttpError(400, 'Tentukan lokasi toko dan titik tujuan');
  const d = await shipping.routeDistance({ lat: s.store_lat, lng: s.store_lng }, { lat, lng });
  const km = Math.round(d.km * 10) / 10;
  res.json({ data: { distance_km: km, source: d.source, estimated: d.estimated, fee: shipping.feeForDistance(km, s), out_of_range: s.shipping_max_km > 0 && km > s.shipping_max_km } });
});

module.exports = router;
