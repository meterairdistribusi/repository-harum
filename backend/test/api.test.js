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
  assert.equal(stats.body.data.today.orders, 1);
  assert.equal(stats.body.data.today.revenue, 40000);
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
  const method = await call('POST', '/api/me/orders', { token: customer, body: { items: [{ product_id: 1, quantity: 5 }], delivery_method: 'pickup', payment_method: 'cash' } });
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
  assert.equal(store.body.data.payment_methods.length, 3);
});
