/**
 * Backup & pemulihan data, serta penghapusan data contoh.
 *
 * File backup (.zip) berisi:
 *   manifest.json  -> info aplikasi & ringkasan isi
 *   harum.db       -> salinan utuh database (pesanan, produk, pelanggan, biaya, pengaturan)
 *   uploads/...    -> semua foto produk, kategori & banner
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { DatabaseSync } = require('node:sqlite');
const db = require('../db');
const config = require('../config');
const { HttpError } = require('../utils');

const APP_ID = 'harum-market';
const REQUIRED_TABLES = ['users', 'categories', 'products', 'orders', 'order_items', 'settings'];

function counts(d) {
  const n = (sql) => d.prepare(sql).get().n;
  const has = (t) => !!d.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t);
  return {
    orders: n('SELECT COUNT(*) AS n FROM orders'),
    products: n('SELECT COUNT(*) AS n FROM products'),
    categories: n('SELECT COUNT(*) AS n FROM categories'),
    customers: n(`SELECT COUNT(*) AS n FROM users WHERE role = 'customer'`),
    expenses: has('expenses') ? n('SELECT COUNT(*) AS n FROM expenses') : 0,
  };
}

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'harum-')), name);
}

/** Buat file backup (.zip) dalam bentuk Buffer. */
function createBackup() {
  const snapshot = tmpFile('harum.db');
  // VACUUM INTO = salinan database yang konsisten walau server sedang dipakai
  db.get().prepare('VACUUM INTO ?').run(snapshot);
  const zip = new AdmZip();
  const manifest = { app: APP_ID, format: 1, created_at: new Date().toISOString(), counts: counts(db.get()) };
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addLocalFile(snapshot, '', 'harum.db');
  if (fs.existsSync(config.uploadDir)) {
    for (const f of fs.readdirSync(config.uploadDir)) {
      const full = path.join(config.uploadDir, f);
      if (f !== '.gitkeep' && fs.statSync(full).isFile()) zip.addLocalFile(full, 'uploads');
    }
  }
  fs.rmSync(path.dirname(snapshot), { recursive: true, force: true });
  return { buffer: zip.toBuffer(), manifest };
}

/** Pulihkan semua data dari file backup. Data saat ini diganti seluruhnya. */
function restoreBackup(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new HttpError(400, 'File bukan backup Harum Market yang valid (.zip)');
  }
  const manifestEntry = zip.getEntry('manifest.json');
  const dbEntry = zip.getEntry('harum.db');
  if (!manifestEntry || !dbEntry) throw new HttpError(400, 'File backup tidak lengkap (manifest.json / harum.db tidak ada)');
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  } catch {
    throw new HttpError(400, 'manifest.json rusak');
  }
  if (manifest.app !== APP_ID) throw new HttpError(400, 'File ini bukan backup Harum Market');

  // Periksa database di file sementara sebelum mengganti data yang sekarang
  const candidate = tmpFile('restore.db');
  fs.writeFileSync(candidate, dbEntry.getData());
  try {
    const check = new DatabaseSync(candidate);
    try {
      const ok = check.prepare('PRAGMA integrity_check').get();
      if (Object.values(ok)[0] !== 'ok') throw new HttpError(400, 'Database di dalam backup rusak');
      const tables = check.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name);
      const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t));
      if (missing.length) throw new HttpError(400, `Backup tidak valid, tabel hilang: ${missing.join(', ')}`);
      if (!check.prepare(`SELECT 1 FROM users WHERE role = 'admin'`).get()) throw new HttpError(400, 'Backup tidak berisi akun admin');
    } finally {
      check.close();
    }
  } catch (err) {
    fs.rmSync(path.dirname(candidate), { recursive: true, force: true });
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'Database di dalam backup tidak bisa dibaca');
  }

  // Ganti database
  const current = db.currentFile();
  const target = current === ':memory:' ? tmpFile('harum.db') : current;
  db.close();
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(target + ext, { force: true });
  fs.copyFileSync(candidate, target);
  fs.rmSync(path.dirname(candidate), { recursive: true, force: true });
  db.open(target); // menjalankan migrasi bila backup dari versi lama

  // Ganti foto
  fs.mkdirSync(config.uploadDir, { recursive: true });
  for (const f of fs.readdirSync(config.uploadDir)) if (f !== '.gitkeep') fs.rmSync(path.join(config.uploadDir, f), { force: true, recursive: true });
  let photos = 0;
  for (const e of zip.getEntries()) {
    if (e.isDirectory || !e.entryName.startsWith('uploads/')) continue;
    const name = path.basename(e.entryName); // cegah path traversal (../)
    if (!name || name.startsWith('.')) continue;
    fs.writeFileSync(path.join(config.uploadDir, name), e.getData());
    photos++;
  }
  return { manifest, counts: counts(db.get()), photos };
}

// ------------------------------------------------------------------ data contoh
const DEMO_PHONE = '081200000000';

function demoSummary() {
  const d = db.get();
  return {
    orders: d.prepare(`SELECT COUNT(*) AS n FROM orders WHERE code LIKE 'DEMO-%'`).get().n,
    expenses: d.prepare(`SELECT COUNT(*) AS n FROM expenses WHERE description LIKE '%(contoh)'`).get().n,
    demo_user: !!d.prepare('SELECT 1 FROM users WHERE phone = ?').get(DEMO_PHONE),
    products: d.prepare('SELECT COUNT(*) AS n FROM products').get().n,
    categories: d.prepare('SELECT COUNT(*) AS n FROM categories').get().n,
    banners: d.prepare('SELECT COUNT(*) AS n FROM banners').get().n,
    all_orders: d.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
    all_expenses: d.prepare('SELECT COUNT(*) AS n FROM expenses').get().n,
    customers: d.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'customer'`).get().n,
  };
}

function setFlag(key) {
  db.get().prepare(`INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = '1'`).run(key);
}

/**
 * Hapus data contoh: pesanan DEMO-xxx, biaya bertanda "(contoh)", akun pelanggan demo.
 * catalog=true juga mengosongkan katalog contoh (kategori, sub menu, banner) agar bisa diisi produk asli.
 */
function removeDemo({ catalog = false } = {}) {
  const d = db.get();
  const removedFiles = [];
  const result = db.transaction(() => {
    const orders = d.prepare(`DELETE FROM orders WHERE code LIKE 'DEMO-%'`).run().changes;
    const expenses = d.prepare(`DELETE FROM expenses WHERE description LIKE '%(contoh)'`).run().changes;
    const demo = d.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO_PHONE);
    let demoUser = false;
    if (demo && !d.prepare('SELECT 1 FROM orders WHERE user_id = ?').get(demo.id)) {
      d.prepare('DELETE FROM users WHERE id = ?').run(demo.id);
      demoUser = true;
    }
    let products = 0;
    if (catalog) {
      for (const p of d.prepare('SELECT image_url, images FROM products').all()) {
        try {
          removedFiles.push(...JSON.parse(p.images || '[]'));
        } catch {}
        removedFiles.push(p.image_url);
      }
      for (const t of ['categories', 'banners']) for (const r of d.prepare(`SELECT image_url FROM ${t}`).all()) removedFiles.push(r.image_url);
      products = d.prepare('DELETE FROM products').run().changes;
      d.prepare('DELETE FROM categories').run();
      d.prepare('DELETE FROM banners').run();
      setFlag('catalog_seed_disabled'); // jangan isi katalog contoh lagi saat server dinyalakan ulang
    }
    setFlag('demo_data_disabled'); // jangan isi data contoh lagi walau DEMO_DATA=1
    return { orders, expenses, demo_user: demoUser, products };
  });
  for (const u of new Set(removedFiles)) {
    if (u && u.startsWith('/uploads/')) fs.rmSync(path.join(config.uploadDir, path.basename(u)), { force: true });
  }
  return result;
}

/** Kosongkan transaksi (mulai dari nol): pesanan, biaya, dan opsional akun pelanggan. Katalog & pengaturan tetap. */
function resetTransactions({ customers = false } = {}) {
  const d = db.get();
  return db.transaction(() => {
    const orders = d.prepare('DELETE FROM orders').run().changes;
    const expenses = d.prepare('DELETE FROM expenses').run().changes;
    const users = customers ? d.prepare(`DELETE FROM users WHERE role = 'customer'`).run().changes : 0;
    setFlag('demo_data_disabled');
    return { orders, expenses, customers: users };
  });
}

module.exports = { createBackup, restoreBackup, demoSummary, removeDemo, resetTransactions };
