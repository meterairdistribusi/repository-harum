/**
 * Sinkronisasi realtime lewat WebSocket (/ws).
 * Setiap perubahan dari panel admin (sub menu, kategori, banner, pengaturan) dan perubahan
 * status pesanan langsung dikirim ke aplikasi pelanggan & panel admin yang sedang terbuka,
 * sehingga tampilan berubah tanpa perlu refresh.
 *
 * Pesan: { type: 'catalog', scope: 'products'|'categories'|'banners'|'store' }
 *        { type: 'order', code, status }   -> hanya ke pemilik pesanan & admin
 */
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const config = require('./config');
const db = require('./db');

const clients = new Set();
let wss = null;

function attach(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const token = new URL(req.url, 'http://x').searchParams.get('token');
    ws.meta = { userId: null, role: 'guest' };
    if (token) {
      try {
        const p = jwt.verify(token, config.jwtSecret);
        ws.meta = { userId: p.sub, role: p.role };
      } catch {}
    }
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
    clients.add(ws);
    ws.send(JSON.stringify({ type: 'hello', role: ws.meta.role }));
  });
  // Putuskan koneksi yang sudah mati (HP tidur, sinyal hilang)
  const timer = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  timer.unref();
  wss.on('close', () => clearInterval(timer));
  return wss;
}

function send(filter, msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === 1 && filter(ws.meta)) ws.send(data);
}

// Gabungkan perubahan katalog yang beruntun (mis. simpan produk + stok) jadi satu pesan
const pending = new Set();
let flushTimer = null;
function catalogChanged(scope) {
  pending.add(scope);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    for (const s of pending) send(() => true, { type: 'catalog', scope: s });
    pending.clear();
  }, 150);
}

function orderChanged(orderId) {
  setImmediate(() => {
    const o = db.get().prepare('SELECT id, code, user_id, status, payment_status, payment_method, total FROM orders WHERE id = ?').get(orderId);
    if (!o) return;
    const msg = { type: 'order', id: o.id, code: o.code, status: o.status, payment_status: o.payment_status, payment_method: o.payment_method, total: o.total };
    send((m) => m.userId === o.user_id || m.role === 'admin', msg);
    // Stok berubah saat pesanan dibuat / dibatalkan
    if (o.status === 'pending_payment' || o.status === 'cancelled' || o.status === 'processing') catalogChanged('products');
  });
}

/** Middleware untuk router admin: kirim notifikasi katalog setelah perubahan berhasil. */
const SCOPES = [
  [/^\/(products|variants)/, 'products'],
  [/^\/categories/, 'categories'],
  [/^\/banners/, 'banners'],
  [/^\/settings/, 'store'],
];
function adminChanges(req, res, next) {
  if (req.method !== 'GET') {
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      const hit = SCOPES.find(([re]) => re.test(req.path));
      if (hit) catalogChanged(hit[1]);
      if (hit && hit[1] === 'categories') catalogChanged('products');
    });
  }
  next();
}

module.exports = { attach, catalogChanged, orderChanged, adminChanges, clientCount: () => clients.size };
