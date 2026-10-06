/**
 * Data awal katalog Harum Group. Dijalankan otomatis saat database masih kosong,
 * atau manual: `npm run seed` (hanya mengisi bila katalog kosong).
 */
const db = require('./db');

const CATEGORIES = [
  { name: 'Es Kristal', slug: 'es-kristal', icon: '🧊', color: '#E0F2FE', description: 'Es kristal higienis dari air murni, cocok untuk minuman & usaha.' },
  { name: 'Es Buah', slug: 'es-buah', icon: '🍉', color: '#FCE7F3', description: 'Segarnya buah pilihan dengan sirup & susu.' },
  { name: 'Es Serut', slug: 'es-serut', icon: '🍧', color: '#EDE9FE', description: 'Es serut lembut dengan aneka topping.' },
  { name: 'Frozen Food', slug: 'frozen-food', icon: '🥟', color: '#FEF3C7', description: 'Makanan beku praktis, tinggal goreng atau kukus.' },
  { name: 'Makanan Siap Saji', slug: 'siap-saji', icon: '🍱', color: '#DCFCE7', description: 'Hidangan hangat siap santap.' },
];

const PRODUCTS = {
  'es-kristal': [
    ['Es Kristal 1 kg', 'Es kristal tabung bening, higienis, tidak cepat cair.', 3000, 'pack', 200, 1],
    ['Es Kristal 5 kg', 'Kemasan hemat untuk warung, kafe dan acara keluarga.', 12000, 'pack', 120, 1],
    ['Es Kristal 10 kg', 'Kemasan karung untuk kebutuhan usaha.', 22000, 'karung', 60, 0],
    ['Es Balok 25 kg', 'Es balok padat untuk pendingin ikan & cool box.', 35000, 'balok', 30, 0],
  ],
  'es-buah': [
    ['Es Buah Spesial', 'Semangka, melon, nanas, kelapa muda, nata de coco, susu & sirup.', 15000, 'cup', 50, 1],
    ['Es Buah Jumbo', 'Porsi jumbo untuk berbagi, isian buah melimpah.', 25000, 'cup', 30, 0],
    ['Es Buah Family Pack 1 L', 'Kemasan 1 liter untuk keluarga.', 40000, 'botol', 20, 0],
  ],
  'es-serut': [
    ['Es Serut Coklat Keju', 'Es serut lembut dengan coklat, keju parut & susu kental manis.', 12000, 'cup', 40, 1],
    ['Es Serut Strawberry', 'Sirup stroberi segar dengan susu.', 10000, 'cup', 40, 0],
    ['Es Serut Durian', 'Topping durian asli yang legit.', 18000, 'cup', 25, 1],
  ],
  'frozen-food': [
    ['Nugget Ayam 500 g', 'Nugget ayam asli tanpa pengawet berlebih.', 32000, 'pack', 40, 1],
    ['Sosis Sapi 500 g', 'Sosis sapi siap goreng atau bakar.', 35000, 'pack', 35, 0],
    ['Dimsum Ayam isi 10', 'Dimsum ayam udang, tinggal kukus 10 menit.', 28000, 'pack', 30, 1],
    ['Kentang Goreng 1 kg', 'Shoestring fries renyah.', 38000, 'pack', 25, 0],
  ],
  'siap-saji': [
    ['Nasi Ayam Geprek', 'Ayam geprek sambal bawang + nasi + lalapan.', 18000, 'porsi', 30, 1],
    ['Nasi Goreng Spesial', 'Nasi goreng dengan telur, ayam suwir & kerupuk.', 20000, 'porsi', 30, 0],
    ['Mie Goreng Jawa', 'Mie goreng bumbu jawa dengan sayur & telur.', 17000, 'porsi', 25, 0],
    ['Paket Hemat Nugget + Nasi', 'Nasi, nugget, sosis & saus.', 15000, 'porsi', 40, 1],
  ],
};

const BANNERS = [
  ['Gratis Ongkir!', 'Belanja min. Rp150.000 bebas ongkos kirim', '#0284C7'],
  ['Segar Setiap Hari', 'Es kristal higienis langsung dari pabrik kami', '#0D9488'],
  ['Stok Frozen Food', 'Praktis untuk bekal & jualan, tinggal goreng', '#EA580C'],
];

function seedCatalog() {
  const d = db.get();
  if (d.prepare('SELECT 1 FROM categories').get()) return false;
  db.transaction(() => {
    const insC = d.prepare('INSERT INTO categories (name, slug, icon, color, description, sort_order) VALUES (?,?,?,?,?,?)');
    const insP = d.prepare('INSERT INTO products (category_id, name, description, price, unit, stock, is_featured) VALUES (?,?,?,?,?,?,?)');
    CATEGORIES.forEach((c, i) => {
      const id = insC.run(c.name, c.slug, c.icon, c.color, c.description, i).lastInsertRowid;
      for (const p of PRODUCTS[c.slug]) insP.run(id, ...p);
    });
    const insB = d.prepare('INSERT INTO banners (title, subtitle, color, sort_order) VALUES (?,?,?,?)');
    BANNERS.forEach((b, i) => insB.run(...b, i));
  });
  console.log('[seed] Katalog contoh Harum Group dibuat');
  return true;
}

module.exports = { seedCatalog };

if (require.main === module) {
  db.open();
  require('./bootstrap').ensureAdmin();
  if (!seedCatalog()) console.log('[seed] Katalog sudah berisi data, dilewati');
}
