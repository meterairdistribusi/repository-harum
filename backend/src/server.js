const config = require('./config');
const db = require('./db');
const { createApp } = require('./app');
const { ensureAdmin } = require('./bootstrap');
const orders = require('./services/orders');
const realtime = require('./realtime');

const WEAK_SECRETS = ['dev-secret-harum-group', 'ganti-dengan-rahasia-yang-panjang'];
if (process.env.NODE_ENV === 'production' && (WEAK_SECRETS.includes(config.jwtSecret) || config.jwtSecret.length < 16)) {
  console.error('JWT_SECRET wajib diisi string acak yang panjang (min. 16 karakter) di produksi (.env)');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && config.payment.provider === 'simulator') {
  console.warn('[PERINGATAN] PAYMENT_PROVIDER=simulator di produksi — siapa pun bisa menandai pesanan lunas. Gunakan midtrans.');
}

db.open();
ensureAdmin();
const flag = (key) => db.get().prepare(`SELECT 1 FROM settings WHERE key = ? AND value = '1'`).get(key);
// Katalog contoh hanya diisi untuk toko yang benar-benar baru (bukan setelah admin mengosongkannya)
if (!db.get().prepare('SELECT 1 FROM categories').get() && !flag('catalog_seed_disabled')) {
  require('./seed').seedCatalog();
}
// Prototype: isi data contoh penjualan & biaya bila DEMO_DATA=1
if (process.env.DEMO_DATA === '1') require('./demo').seedDemo();

const app = createApp();
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`Harum Market API : ${config.publicUrl}/api`);
  console.log(`Panel Admin      : ${config.publicUrl}/admin`);
  console.log(`Payment provider : ${config.payment.provider}`);
});
realtime.attach(server);

// Batalkan otomatis pesanan yang lewat batas waktu bayar (mode simulator).
setInterval(() => {
  const n = orders.expireOverdue();
  if (n) console.log(`[orders] ${n} pesanan kedaluwarsa dibatalkan`);
}, 60 * 1000).unref();
