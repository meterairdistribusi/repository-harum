/**
 * Data awal katalog Harum Market. Dijalankan otomatis saat database masih kosong,
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

// Sub menu per kategori. Bila punya `options`, pelanggan memilih salah satu (harga & stok per pilihan).
// Format pilihan: [nama, harga, stok]
const PRODUCTS = {
  'es-kristal': [
    { name: 'Es Kristal Tabung', desc: 'Es kristal tabung bening, higienis, tidak cepat cair. Cocok untuk warung, kafe & acara.', unit: 'pack', featured: 1, option_label: 'Ukuran', options: [['1 kg', 3000, 200], ['5 kg', 12000, 120], ['10 kg', 22000, 60]] },
    { name: 'Es Balok 25 kg', desc: 'Es balok padat untuk pendingin ikan & cool box.', unit: 'balok', price: 35000, stock: 30 },
  ],
  'es-buah': [
    { name: 'Es Buah Spesial', desc: 'Semangka, melon, nanas, kelapa muda, nata de coco, susu & sirup.', unit: 'cup', featured: 1, option_label: 'Ukuran', options: [['Cup', 15000, 50], ['Jumbo', 25000, 30], ['Family Pack 1 L', 40000, 20]] },
  ],
  'es-serut': [
    { name: 'Es Serut', desc: 'Es serut lembut dengan susu dan topping pilihan.', unit: 'cup', featured: 1, option_label: 'Rasa', options: [['Coklat Keju', 12000, 40], ['Strawberry', 10000, 40], ['Durian', 18000, 25]] },
  ],
  'frozen-food': [
    { name: 'Nugget Ayam', desc: 'Nugget ayam asli, tinggal goreng.', unit: 'pack', featured: 1, option_label: 'Berat', options: [['250 g', 17000, 40], ['500 g', 32000, 40], ['1 kg', 60000, 20]] },
    { name: 'Sosis Sapi 500 g', desc: 'Sosis sapi siap goreng atau bakar.', unit: 'pack', price: 35000, stock: 35 },
    { name: 'Dimsum Ayam isi 10', desc: 'Dimsum ayam udang, tinggal kukus 10 menit.', unit: 'pack', price: 28000, stock: 30, featured: 1 },
    { name: 'Kentang Goreng 1 kg', desc: 'Shoestring fries renyah.', unit: 'pack', price: 38000, stock: 25 },
  ],
  'siap-saji': [
    { name: 'Nasi Ayam Geprek', desc: 'Ayam geprek sambal bawang + nasi + lalapan.', unit: 'porsi', featured: 1, option_label: 'Porsi', options: [['Biasa', 18000, 30], ['Jumbo', 23000, 20]] },
    { name: 'Nasi Goreng Spesial', desc: 'Nasi goreng dengan telur, ayam suwir & kerupuk.', unit: 'porsi', price: 20000, stock: 30 },
    { name: 'Mie Goreng Jawa', desc: 'Mie goreng bumbu jawa dengan sayur & telur.', unit: 'porsi', price: 17000, stock: 25 },
    { name: 'Paket Hemat Nugget + Nasi', desc: 'Nasi, nugget, sosis & saus.', unit: 'porsi', price: 15000, stock: 40, featured: 1 },
  ],
};

// Perkiraan harga modal (HPP) sebagai persen dari harga jual — ubah di panel admin
const COST_RATIO = { 'es-kristal': 0.45, 'es-buah': 0.55, 'es-serut': 0.5, 'frozen-food': 0.7, 'siap-saji': 0.6 };

const BANNERS = [
  ['Gratis Ongkir!', 'Belanja min. Rp150.000 bebas ongkos kirim', '#0284C7'],
  ['Segar Setiap Hari', 'Es kristal higienis, diantar langsung ke rumah', '#0D9488'],
  ['Stok Frozen Food', 'Praktis untuk bekal & jualan, tinggal goreng', '#EA580C'],
];

function seedCatalog() {
  const d = db.get();
  if (d.prepare('SELECT 1 FROM categories').get()) return false;
  db.transaction(() => {
    const insC = d.prepare('INSERT INTO categories (name, slug, icon, color, description, sort_order) VALUES (?,?,?,?,?,?)');
    const insP = d.prepare(
      'INSERT INTO products (category_id, name, description, unit, price, cost_price, stock, is_featured, option_label) VALUES (?,?,?,?,?,?,?,?,?)'
    );
    const insV = d.prepare('INSERT INTO product_variants (product_id, name, price, cost_price, stock, sort_order) VALUES (?,?,?,?,?,?)');
    CATEGORIES.forEach((c, i) => {
      const id = insC.run(c.name, c.slug, c.icon, c.color, c.description, i).lastInsertRowid;
      const cost = (price) => Math.round((price * COST_RATIO[c.slug]) / 100) * 100;
      for (const p of PRODUCTS[c.slug]) {
        const price = p.price ?? p.options[0][1];
        const pid = insP.run(id, p.name, p.desc, p.unit, price, cost(price), p.stock ?? 0, p.featured ? 1 : 0, p.option_label || '').lastInsertRowid;
        (p.options || []).forEach(([name, vprice, stock], k) => insV.run(pid, name, vprice, cost(vprice), stock, k));
      }
    });
    const insB = d.prepare('INSERT INTO banners (title, subtitle, color, sort_order) VALUES (?,?,?,?)');
    BANNERS.forEach((b, i) => insB.run(...b, i));
  });
  console.log('[seed] Katalog contoh Harum Market dibuat');
  return true;
}

module.exports = { seedCatalog };

if (require.main === module) {
  db.open();
  require('./bootstrap').ensureAdmin();
  if (!seedCatalog()) console.log('[seed] Katalog sudah berisi data, dilewati');
}
