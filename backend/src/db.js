const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  icon TEXT NOT NULL DEFAULT '🧊',
  color TEXT NOT NULL DEFAULT '#E0F2FE',
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price >= 0),
  cost_price INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pcs',
  image_url TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Rumah',
  recipient TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  lat REAL,
  lng REAL,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','paid','processing','shipping','ready_pickup','completed','cancelled')),
  delivery_method TEXT NOT NULL CHECK (delivery_method IN ('delivery','pickup')),
  recipient TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  subtotal INTEGER NOT NULL,
  delivery_fee INTEGER NOT NULL DEFAULT 0,
  distance_km REAL,
  total INTEGER NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('qris','bank_transfer','ewallet','cash')),
  payment_channel TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','expired','failed','refunded')),
  payment_provider TEXT NOT NULL DEFAULT '',
  payment_ref TEXT NOT NULL DEFAULT '',
  payment_url TEXT NOT NULL DEFAULT '',
  payment_expires_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  image_url TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL,
  cost_price INTEGER NOT NULL DEFAULT 0,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  subtotal INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#0EA5E9',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
`;

let db;

function open(file = config.dbFile) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Tabel orders versi terbaru, diambil dari SCHEMA (dipakai saat migrasi). */
const ORDERS_DDL = SCHEMA.match(/CREATE TABLE IF NOT EXISTS orders \([\s\S]*?\n\);/)[0];

/** Perbarui database lama agar sesuai SCHEMA terbaru tanpa kehilangan data. */
function migrate(d) {
  const columns = (table) => d.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const addColumn = (table, col, def) => {
    if (!columns(table).includes(col)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  };
  addColumn('products', 'cost_price', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('order_items', 'cost_price', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('addresses', 'lat', 'REAL');
  addColumn('addresses', 'lng', 'REAL');

  // v1.1: metode bayar 'cash' + kolom distance_km. CHECK constraint SQLite hanya bisa
  // diubah dengan membuat ulang tabel (prosedur resmi: buat baru, salin, hapus, ganti nama).
  const ordersSql = d.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'orders'`).get().sql;
  if (!ordersSql.includes("'cash'")) {
    const oldCols = columns('orders');
    d.exec('PRAGMA foreign_keys = OFF');
    d.exec('BEGIN');
    try {
      d.exec(ORDERS_DDL.replace('CREATE TABLE IF NOT EXISTS orders', 'CREATE TABLE orders_new'));
      const common = columns('orders_new').filter((c) => oldCols.includes(c)).join(', ');
      d.exec(`INSERT INTO orders_new (${common}) SELECT ${common} FROM orders`);
      d.exec('DROP TABLE orders');
      d.exec('ALTER TABLE orders_new RENAME TO orders');
      d.exec('CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)');
      d.exec('CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)');
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    } finally {
      d.exec('PRAGMA foreign_keys = ON');
    }
  }

  // v1.1: nama aplikasi menjadi Harum Market
  d.prepare(`UPDATE settings SET value = 'Harum Market' WHERE key = 'store_name' AND value = 'Harum Group'`).run();
  d.prepare(`DELETE FROM settings WHERE key = 'store_tagline' AND value LIKE '%hulu%'`).run();
}

function get() {
  if (!db) open();
  return db;
}

/** Jalankan fn di dalam transaksi; rollback otomatis bila error. */
function transaction(fn) {
  const d = get();
  d.exec('BEGIN');
  try {
    const result = fn(d);
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

/** Ubah object null-prototype dari node:sqlite menjadi object biasa. */
const plain = (row) => (row ? { ...row } : row);

/** Khusus tes: kembalikan koneksi sebelumnya. */
function _set(d) {
  db = d;
}

module.exports = { open, get, transaction, plain, _set };
