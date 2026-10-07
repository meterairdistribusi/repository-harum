/**
 * Data contoh untuk PROTOTYPE / UJI COBA saja: riwayat penjualan beberapa bulan terakhir,
 * biaya operasional, dan akun pelanggan demo. Jangan dijalankan di toko yang sudah beroperasi.
 *
 *   npm run demo:data           (atau DEMO_DATA=1 saat server dijalankan)
 *
 * Pesanan contoh berkode DEMO-xxx. Akun pelanggan demo: 081200000000 / demo123
 */
const bcrypt = require('bcryptjs');
const db = require('./db');

const EXPENSES = [
  ['Gaji karyawan', 'Gaji karyawan paruh waktu', 1200000, 25],
  ['Sewa tempat', 'Sewa kios', 600000, 1],
  ['Listrik & air', 'Listrik mesin es & freezer', 450000, 5],
  ['Bensin & transport', 'Bensin motor antar', 250000, 15],
  ['Kemasan & plastik', 'Plastik, cup & sedotan', 200000, 10],
];

function seedDemo() {
  const d = db.get();
  if (d.prepare(`SELECT 1 FROM orders WHERE code LIKE 'DEMO-%'`).get()) return false;
  // Admin sudah menghapus data contoh -> jangan diisi lagi
  if (d.prepare(`SELECT 1 FROM settings WHERE key = 'demo_data_disabled' AND value = '1'`).get()) return false;
  const lines = d
    .prepare(
      `SELECT p.id AS product_id, p.name AS pname, p.unit, v.id AS variant_id, v.name AS vname,
              COALESCE(v.price, p.price) AS price, COALESCE(v.cost_price, p.cost_price) AS cost_price
       FROM products p LEFT JOIN product_variants v ON v.product_id = p.id WHERE p.is_active = 1`
    )
    .all()
    .map(db.plain);
  if (!lines.length) return false;

  db.transaction(() => {
    let user = d.prepare(`SELECT id FROM users WHERE phone = '081200000000'`).get();
    if (!user) {
      const id = d.prepare(`INSERT INTO users (name, phone, password_hash) VALUES ('Pelanggan Demo', '081200000000', ?)`).run(bcrypt.hashSync('demo123', 10)).lastInsertRowid;
      user = { id };
    }
    const now = new Date();
    let seq = 0;
    // 8 bulan terakhir + bulan berjalan sampai kemarin, penjualan makin ramai
    for (let back = 8; back >= 0; back--) {
      const month = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const ym = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
      const fullDays = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      const days = back === 0 ? now.getDate() - 1 : fullDays;
      if (days < 1) continue;
      const count = Math.round((45 + (8 - back) * 7 + (back % 3) * 6) * (days / fullDays));
      for (let k = 0; k < count; k++) {
        const day = String(1 + ((k * 7 + back) % days)).padStart(2, '0');
        const when = `${ym}-${day} ${String(1 + (k % 12)).padStart(2, '0')}:${String((k * 13) % 60).padStart(2, '0')}:00`;
        const picks = [0, 1, 2].slice(0, 1 + (k % 3)).map((j) => lines[(k * 5 + j * 7 + back * 3) % lines.length]);
        const items = picks.map((l, j) => ({ ...l, quantity: 1 + ((k + j) % 4) }));
        const subtotal = items.reduce((a, i) => a + i.price * i.quantity, 0);
        const fee = k % 2 ? 10000 : 0;
        const method = ['qris', 'cash', 'bank_transfer', 'ewallet'][k % 4];
        const oid = d
          .prepare(
            `INSERT INTO orders (code, user_id, status, delivery_method, recipient, phone, address, subtotal, delivery_fee, total, payment_method, payment_channel, payment_status, payment_provider, created_at, updated_at, paid_at)
             VALUES (?, ?, 'completed', ?, 'Pelanggan Demo', '081200000000', ?, ?, ?, ?, ?, ?, 'paid', 'demo', ?, ?, ?)`
          )
          .run(`DEMO-${++seq}`, user.id, fee ? 'delivery' : 'pickup', fee ? 'Alamat contoh' : '', subtotal, fee, subtotal + fee, method, { qris: 'qris', cash: 'cash', bank_transfer: 'bca', ewallet: 'gopay' }[method], when, when, when).lastInsertRowid;
        for (const i of items) {
          d.prepare(
            `INSERT INTO order_items (order_id, product_id, variant_id, variant_name, name, unit, price, cost_price, quantity, subtotal) VALUES (?,?,?,?,?,?,?,?,?,?)`
          ).run(oid, i.product_id, i.variant_id, i.vname || '', i.vname ? `${i.pname} (${i.vname})` : i.pname, i.unit, i.price, i.cost_price, i.quantity, i.price * i.quantity);
        }
        d.prepare(`INSERT INTO order_history (order_id, status, note, created_at) VALUES (?, 'completed', 'Data contoh', ?)`).run(oid, when);
      }
      for (const [category, description, amount, day] of EXPENSES) {
        if (back === 0 && day > days) continue; // bulan berjalan: hanya biaya yang sudah lewat tanggalnya
        d.prepare('INSERT INTO expenses (date, category, description, amount) VALUES (?,?,?,?)').run(`${ym}-${String(Math.min(day, days)).padStart(2, '0')}`, category, description + ' (contoh)', amount);
      }
    }
    console.log(`[demo] ${seq} pesanan contoh + biaya operasional 9 bulan dibuat. Akun pelanggan demo: 081200000000 / demo123`);
  });
  return true;
}

module.exports = { seedDemo };

if (require.main === module) {
  db.open();
  require('./bootstrap').ensureAdmin();
  require('./seed').seedCatalog();
  if (!seedDemo()) console.log('[demo] Data contoh sudah ada, dilewati');
}
