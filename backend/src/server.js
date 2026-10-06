const config = require('./config');
const db = require('./db');
const { createApp } = require('./app');
const { ensureAdmin } = require('./bootstrap');
const orders = require('./services/orders');

if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-secret-harum-group') {
  console.error('JWT_SECRET wajib diisi di produksi (.env)');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production' && config.payment.provider === 'simulator') {
  console.warn('[PERINGATAN] PAYMENT_PROVIDER=simulator di produksi — siapa pun bisa menandai pesanan lunas. Gunakan midtrans.');
}

db.open();
ensureAdmin();
if (!db.get().prepare('SELECT 1 FROM categories').get()) {
  require('./seed').seedCatalog();
}

const app = createApp();
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Harum Group API  : ${config.publicUrl}/api`);
  console.log(`Panel Admin      : ${config.publicUrl}/admin`);
  console.log(`Payment provider : ${config.payment.provider}`);
});

// Batalkan otomatis pesanan yang lewat batas waktu bayar (mode simulator).
setInterval(() => {
  const n = orders.expireOverdue();
  if (n) console.log(`[orders] ${n} pesanan kedaluwarsa dibatalkan`);
}, 60 * 1000).unref();
