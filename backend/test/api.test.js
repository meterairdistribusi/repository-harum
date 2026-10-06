const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.PAYMENT_PROVIDER = 'simulator';
const config = require('../src/config');
const db = require('../src/db');
db.open(':memory:');
require('../src/bootstrap').ensureAdmin();
require('../src/seed').seedCatalog();
const { createApp } = require('../src/app');

let server;
let base;
before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : form, redirect: 'manual' });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

const stockOf = (id) => db.get().prepare('SELECT stock FROM products WHERE id = ?').get(id).stock;

let customer;
let admin;

test('register & login pelanggan', async () => {
  const r = await call('POST', '/api/auth/register', { body: { name: 'Bu Sari', phone: '+62 812-3456-7890', password: 'rahasia1' } });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.phone, '081234567890');
  assert.equal(r.body.user.password_hash, undefined);

  const dup = await call('POST', '/api/auth/register', { body: { name: 'X', phone: '081234567890', password: 'rahasia1' } });
  assert.equal(dup.status, 409);

  const bad = await call('POST', '/api/auth/login', { body: { login: '081234567890', password: 'salah' } });
  assert.equal(bad.status, 401);

  const ok = await call('POST', '/api/auth/login', { body: { login: '6281234567890', password: 'rahasia1' } });
  assert.equal(ok.status, 200);
  customer = ok.body.token;

  const a = await call('POST', '/api/auth/login', { body: { login: config.adminEmail, password: config.adminPassword } });
  assert.equal(a.body.user.role, 'admin');
  admin = a.body.token;
});

test('pelanggan tidak bisa akses API admin', async () => {
  assert.equal((await call('GET', '/api/admin/stats', { token: customer })).status, 403);
  assert.equal((await call('GET', '/api/admin/stats')).status, 401);
});

test('quote menghitung ongkir & gratis ongkir', async () => {
  const small = await call('POST', '/api/me/checkout/quote', { token: customer, body: { items: [{ product_id: 1, quantity: 5 }], delivery_method: 'delivery' } });
  assert.equal(small.body.data.subtotal, 15000);
  assert.equal(small.body.data.delivery_fee, 10000);
  const pickup = await call('POST', '/api/me/checkout/quote', { token: customer, body: { items: [{ product_id: 1, quantity: 5 }], delivery_method: 'pickup' } });
  assert.equal(pickup.body.data.delivery_fee, 0);
  const big = await call('POST', '/api/me/checkout/quote', { token: customer, body: { items: [{ product_id: 2, quantity: 13 }] } });
  assert.equal(big.body.data.delivery_fee, 0);
});

test('alur pesanan QRIS: buat -> bayar (simulasi) -> diproses -> diantar -> selesai', async () => {
  const addr = await call('POST', '/api/me/addresses', { token: customer, body: { recipient: 'Bu Sari', phone: '081234567890', address: 'Jl. Melati 5' } });
  assert.equal(addr.status, 201);
  assert.equal(addr.body.data.is_default, 1);

  const before = stockOf(5);
  const r = await call('POST', '/api/me/orders', {
    token: customer,
    body: { items: [{ product_id: 5, quantity: 2 }], delivery_method: 'delivery', address_id: addr.body.data.id, payment_method: 'qris' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const order = r.body.data;
  assert.equal(order.status, 'pending_payment');
  assert.equal(order.total, 2 * 15000 + 10000);
  assert.equal(order.address, 'Jl. Melati 5');
  assert.match(order.payment_url, /\/pay\/HRM-/);
  assert.equal(stockOf(5), before - 2);

  const page = await call('GET', `/pay/${order.code}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /data:image\/png;base64/);

  const sim = await call('POST', `/pay/${order.code}/simulate`, { form: '' });
  assert.equal(sim.status, 302);

  const paid = await call('GET', `/api/me/orders/${order.code}`, { token: customer });
  assert.equal(paid.body.data.status, 'paid');
  assert.equal(paid.body.data.payment_status, 'paid');

  const cancelPaid = await call('POST', `/api/me/orders/${order.code}/cancel`, { token: customer });
  assert.equal(cancelPaid.status, 400);

  const adminView = await call('GET', `/api/admin/orders/${order.id}`, { token: admin });
  assert.deepEqual(adminView.body.data.next_statuses, ['processing', 'cancelled']);
  const bad = await call('POST', `/api/admin/orders/${order.id}/status`, { token: admin, body: { status: 'ready_pickup' } });
  assert.equal(bad.status, 400);
  for (const s of ['processing', 'shipping', 'completed']) {
    const u = await call('POST', `/api/admin/orders/${order.id}/status`, { token: admin, body: { status: s } });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    assert.equal(u.body.data.status, s);
    if (s === 'processing') assert.deepEqual(u.body.data.next_statuses, ['shipping', 'cancelled']);
  }
  const det = await call('GET', `/api/admin/orders/${order.id}`, { token: admin });
  assert.deepEqual(det.body.data.history.map((h) => h.status), ['pending_payment', 'paid', 'processing', 'shipping', 'completed']);

  const stats = await call('GET', '/api/admin/stats', { token: admin });
  const st = stats.body.data;
  assert.equal(st.today.orders, 1);
  assert.equal(st.today.revenue, 30000); // omzet = penjualan produk, tanpa ongkir
  const cost = db.get().prepare('SELECT cost_price FROM products WHERE id = 5').get().cost_price;
  assert.ok(cost > 0);
  assert.equal(st.today.cost, 2 * cost);
  assert.equal(st.today.profit, 30000 - 2 * cost);
  assert.equal(st.monthly.length, 12);
  assert.equal(st.monthly[new Date().getMonth()].revenue, 30000);
  assert.equal(st.monthly[new Date().getMonth()].profit, 30000 - 2 * cost);
  assert.ok(Math.abs(st.month.margin_on_cost - (30000 - 2 * cost) / (2 * cost)) < 1e-9);
});

test('batal pesanan mengembalikan stok', async () => {
  const before = stockOf(12);
  const r = await call('POST', '/api/me/orders', {
    token: customer,
    body: { items: [{ product_id: 12, quantity: 1 }], delivery_method: 'pickup', payment_method: 'bank_transfer', payment_channel: 'bca' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.data.delivery_fee, 0);
  assert.equal(stockOf(12), before - 1);
  const c = await call('POST', `/api/me/orders/${r.body.data.code}/cancel`, { token: customer });
  assert.equal(c.body.data.status, 'cancelled');
  assert.equal(stockOf(12), before);
});

test('validasi pesanan: stok, metode bayar, alamat', async () => {
  const stock = await call('POST', '/api/me/orders', { token: customer, body: { items: [{ product_id: 1, quantity: 99999 }], delivery_method: 'pickup', payment_method: 'qris' } });
  assert.equal(stock.status, 400);
  assert.match(stock.body.error, /Stok/);
  const method = await call('POST', '/api/me/orders', { token: customer, body: { items: [{ product_id: 1, quantity: 5 }], delivery_method: 'pickup', payment_method: 'kredit' } });
  assert.equal(method.status, 400);
  const ch = await call('POST', '/api/me/orders', { token: customer, body: { items: [{ product_id: 1, quantity: 5 }], delivery_method: 'pickup', payment_method: 'ewallet', payment_channel: 'bca' } });
  assert.equal(ch.status, 400);
  const addr = await call('POST', '/api/me/orders', { token: customer, body: { items: [{ product_id: 1, quantity: 5 }], delivery_method: 'delivery', payment_method: 'qris' } });
  assert.equal(addr.status, 400);
  const minimum = await call('POST', '/api/me/orders', { token: customer, body: { items: [{ product_id: 1, quantity: 1 }], delivery_method: 'pickup', payment_method: 'qris' } });
  assert.equal(minimum.status, 400);
  assert.match(minimum.body.error, /Minimal/);
});

test('webhook Midtrans memverifikasi signature dan menandai lunas', async () => {
  const r = await call('POST', '/api/me/orders', {
    token: customer,
    body: { items: [{ product_id: 9, quantity: 2 }], delivery_method: 'pickup', payment_method: 'ewallet', payment_channel: 'gopay' },
  });
  const order = r.body.data;
  config.payment.midtrans.serverKey = 'SB-Mid-server-test';
  const n = { order_id: order.code, status_code: '200', gross_amount: `${order.total}.00`, transaction_status: 'settlement', transaction_id: 'trx-1' };
  const forged = await call('POST', '/api/payments/midtrans/notification', { body: { ...n, signature_key: 'x'.repeat(128) } });
  assert.equal(forged.status, 403);

  n.signature_key = crypto.createHash('sha512').update(`${n.order_id}${n.status_code}${n.gross_amount}SB-Mid-server-test`).digest('hex');
  const ok = await call('POST', '/api/payments/midtrans/notification', { body: n });
  assert.equal(ok.status, 200);
  const o = await call('GET', `/api/admin/orders/${order.id}`, { token: admin });
  assert.equal(o.body.data.status, 'paid');
  assert.equal(o.body.data.payment_ref, 'trx-1');
  config.payment.midtrans.serverKey = '';
});

test('admin kelola produk & pengaturan', async () => {
  const p = await call('POST', '/api/admin/products', { token: admin, body: { name: 'Es Teh Jumbo', category_id: 5, price: 5000, stock: 10, unit: 'cup' } });
  assert.equal(p.status, 201);
  const list = await call('GET', '/api/products?q=Teh%20Jumbo');
  assert.equal(list.body.data.length, 1);
  await call('PUT', `/api/admin/products/${p.body.data.id}`, { token: admin, body: { name: 'Es Teh Jumbo', category_id: 5, price: 6000, stock: 10, is_active: false } });
  assert.equal((await call('GET', '/api/products?q=Teh%20Jumbo')).body.data.length, 0);

  const s = await call('PUT', '/api/admin/settings', { token: admin, body: { delivery_fee: 8000, is_open: false } });
  assert.equal(s.body.data.delivery_fee, 8000);
  assert.equal(s.body.data.is_open, false);
  const closed = await call('POST', '/api/me/orders', { token: customer, body: { items: [{ product_id: 1, quantity: 5 }], delivery_method: 'pickup', payment_method: 'qris' } });
  assert.match(closed.body.error, /tutup/);
  await call('PUT', '/api/admin/settings', { token: admin, body: { is_open: true } });

  const store = await call('GET', '/api/store');
  assert.deepEqual(store.body.data.payment_methods.map((m) => m.code), ['qris', 'bank_transfer', 'ewallet', 'cash']);
  assert.equal(store.body.data.store_location_set, false);
});

test('harga modal tidak bocor ke pelanggan', async () => {
  const list = await call('GET', '/api/products');
  assert.ok(list.body.data.length > 0);
  assert.ok(list.body.data.every((p) => !('cost_price' in p)));
  assert.ok(!('cost_price' in (await call('GET', '/api/products/1')).body.data));
  const orders = await call('GET', '/api/me/orders', { token: customer });
  const det = await call('GET', `/api/me/orders/${orders.body.data[0].code}`, { token: customer });
  assert.ok(det.body.data.items.every((i) => !('cost_price' in i)));
});

test('pembayaran tunai: langsung diproses, lunas saat selesai', async () => {
  const r = await call('POST', '/api/me/orders', {
    token: customer,
    body: { items: [{ product_id: 1, quantity: 5 }], delivery_method: 'pickup', payment_method: 'cash' },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const o = r.body.data;
  assert.equal(o.status, 'processing');
  assert.equal(o.payment_status, 'unpaid');
  assert.equal(o.payment_url, '');
  assert.equal(o.payment_provider, 'cash');
  for (const s of ['ready_pickup', 'completed']) {
    const u = await call('POST', `/api/admin/orders/${o.id}/status`, { token: admin, body: { status: s } });
    assert.equal(u.status, 200, JSON.stringify(u.body));
  }
  const done = await call('GET', `/api/me/orders/${o.code}`, { token: customer });
  assert.equal(done.body.data.payment_status, 'paid');
  assert.ok(done.body.data.paid_at);

  await call('PUT', '/api/admin/settings', { token: admin, body: { cash_enabled: false } });
  const off = await call('POST', '/api/me/orders', { token: customer, body: { items: [{ product_id: 1, quantity: 5 }], delivery_method: 'pickup', payment_method: 'cash' } });
  assert.equal(off.status, 400);
  assert.ok(!(await call('GET', '/api/store')).body.data.payment_methods.some((m) => m.code === 'cash'));
  await call('PUT', '/api/admin/settings', { token: admin, body: { cash_enabled: true } });
});

test('ongkir berdasarkan jarak tempuh di peta', async () => {
  // Server OSRM tiruan: jarak jalan 5,3 km
  const http = require('node:http');
  let hits = 0;
  const osrm = http.createServer((req, res) => {
    hits++;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ code: 'Ok', routes: [{ distance: 5300 }] }));
  });
  await new Promise((r) => osrm.listen(0, r));
  config.maps.osrmUrl = `http://127.0.0.1:${osrm.address().port}`;

  await call('PUT', '/api/admin/settings', {
    token: admin,
    body: { shipping_mode: 'distance', store_lat: -6.2, store_lng: 106.8, shipping_base_fee: 8000, shipping_base_km: 2, shipping_per_km: 2500, shipping_max_km: 15, free_delivery_min: 0 },
  });
  const store = (await call('GET', '/api/store')).body.data;
  assert.equal(store.shipping_mode, 'distance');
  assert.equal(store.store_location_set, true);

  const noPin = await call('POST', '/api/me/addresses', { token: customer, body: { recipient: 'A', phone: '081234567890', address: 'Tanpa titik' } });
  const quoteNoPin = await call('POST', '/api/me/checkout/quote', { token: customer, body: { items: [{ product_id: 2, quantity: 2 }], delivery_method: 'delivery', address_id: noPin.body.data.id } });
  assert.match(quoteNoPin.body.data.shipping_error, /peta/);

  const pin = await call('POST', '/api/me/addresses', { token: customer, body: { recipient: 'B', phone: '081234567890', address: 'Ada titik', lat: -6.24, lng: 106.83 } });
  assert.equal(pin.body.data.lat, -6.24);
  const q = await call('POST', '/api/me/checkout/quote', { token: customer, body: { items: [{ product_id: 2, quantity: 2 }], delivery_method: 'delivery', address_id: pin.body.data.id } });
  assert.equal(q.body.data.distance_km, 5.3);
  assert.equal(q.body.data.delivery_fee, 8000 + 4 * 2500); // 2 km pertama 8000, sisa 3,3 km dibulatkan 4 km
  assert.equal(q.body.data.problems.length, 0);

  const o = await call('POST', '/api/me/orders', { token: customer, body: { items: [{ product_id: 2, quantity: 2 }], delivery_method: 'delivery', address_id: pin.body.data.id, payment_method: 'cash' } });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal(o.body.data.delivery_fee, 18000);
  assert.equal(o.body.data.distance_km, 5.3);
  assert.equal(hits, 1); // jarak di-cache

  const preview = await call('GET', '/api/admin/shipping/preview?lat=-6.3&lng=106.9', { token: admin });
  assert.equal(preview.body.data.distance_km, 5.3);

  // Di luar jangkauan
  await call('PUT', '/api/admin/settings', { token: admin, body: { shipping_max_km: 5 } });
  const far = await call('POST', '/api/me/orders', { token: customer, body: { items: [{ product_id: 2, quantity: 2 }], delivery_method: 'delivery', address_id: pin.body.data.id, payment_method: 'cash' } });
  assert.equal(far.status, 400);
  assert.match(far.body.error, /jangkauan/);

  // Layanan peta mati -> perkiraan garis lurus
  osrm.close();
  config.maps.osrmUrl = 'http://127.0.0.1:1';
  await call('PUT', '/api/admin/settings', { token: admin, body: { shipping_max_km: 50 } });
  const pin2 = await call('POST', '/api/me/addresses', { token: customer, body: { recipient: 'C', phone: '081234567890', address: 'Lain', lat: -6.25, lng: 106.85 } });
  const est = await call('POST', '/api/me/checkout/quote', { token: customer, body: { items: [{ product_id: 2, quantity: 2 }], delivery_method: 'delivery', address_id: pin2.body.data.id } });
  assert.equal(est.body.data.distance_estimated, true);
  assert.ok(est.body.data.distance_km > 7 && est.body.data.distance_km < 12);

  await call('PUT', '/api/admin/settings', { token: admin, body: { shipping_mode: 'flat', free_delivery_min: 150000 } });
});

test('migrasi database versi lama (tanpa metode cash)', () => {
  const { DatabaseSync } = require('node:sqlite');
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harum-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, phone TEXT UNIQUE, email TEXT UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'pending_payment', delivery_method TEXT NOT NULL, recipient TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', subtotal INTEGER NOT NULL, delivery_fee INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL, payment_method TEXT NOT NULL CHECK (payment_method IN ('qris','bank_transfer','ewallet')), payment_channel TEXT NOT NULL DEFAULT '', payment_status TEXT NOT NULL DEFAULT 'unpaid', payment_provider TEXT NOT NULL DEFAULT '', payment_ref TEXT NOT NULL DEFAULT '', payment_url TEXT NOT NULL DEFAULT '', payment_expires_at TEXT, paid_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'pcs', image_url TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL, quantity INTEGER NOT NULL, subtotal INTEGER NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO users (name, password_hash) VALUES ('x', 'x');
    INSERT INTO orders (code, user_id, delivery_method, subtotal, total, payment_method) VALUES ('LAMA-1', 1, 'pickup', 5000, 5000, 'qris');
    INSERT INTO order_items (order_id, name, price, quantity, subtotal) VALUES (1, 'Es', 5000, 1, 5000);
    INSERT INTO settings VALUES ('store_name', 'Harum Group'), ('store_tagline', 'Segar dari hulu hingga hilir');`);
  old.close();

  const current = db.get();
  const migrated = db.open(file);
  try {
    assert.equal(migrated.prepare('SELECT code FROM orders').get().code, 'LAMA-1');
    assert.equal(migrated.prepare('SELECT cost_price FROM order_items').get().cost_price, 0);
    assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
    migrated.prepare(`INSERT INTO orders (code, user_id, delivery_method, subtotal, total, payment_method) VALUES ('BARU', 1, 'pickup', 1, 1, 'cash')`).run();
    assert.equal(migrated.prepare(`SELECT value FROM settings WHERE key = 'store_name'`).get().value, 'Harum Market');
    assert.equal(migrated.prepare(`SELECT value FROM settings WHERE key = 'store_tagline'`).get(), undefined);
  } finally {
    migrated.close();
    db._set(current);
  }
});
