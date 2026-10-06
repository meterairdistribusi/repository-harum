const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { HttpError } = require('./utils');

/** Halaman awal: tautan ke aplikasi pelanggan & panel admin (memudahkan uji coba). */
function landing() {
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Harum Market</title><style>body{margin:0;font-family:system-ui,-apple-system,Roboto,sans-serif;background:linear-gradient(135deg,#0EA5E9,#0369A1);min-height:100vh;display:grid;place-items:center;padding:16px;box-sizing:border-box}
.c{background:#fff;border-radius:22px;padding:32px;max-width:420px;width:100%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,.2)}h1{margin:8px 0 4px;color:#075985}p{color:#64748B}
a{display:block;padding:16px;border-radius:14px;font-weight:700;font-size:18px;text-decoration:none;margin-top:12px}.a{background:#0284C7;color:#fff}.b{background:#E0F2FE;color:#075985}</style></head>
<body><div class="c"><div style="font-size:56px">🧊</div><h1>Harum Market</h1><p>Prototype uji coba</p>
<a class="a" href="/app/">🛒 Buka Aplikasi Pelanggan</a><a class="b" href="/admin/">⚙️ Panel Admin</a>
<p style="font-size:13px;margin-top:18px">Buka dari HP: gunakan alamat yang sama di browser HP (satu jaringan Wi-Fi).</p></div></body></html>`;
}

function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, payment_provider: config.payment.provider }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api', require('./routes/catalog'));
  app.use('/api/payments', require('./routes/payments').api);
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/me', require('./routes/customer'));
  app.use('/pay', require('./routes/payments').pages);

  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }));
  app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
  // Library pihak ketiga disajikan dari node_modules (tidak bergantung CDN)
  const nm = path.join(__dirname, '..', 'node_modules');
  app.get('/vendor/chart.umd.js', (_req, res) => res.sendFile(path.join(nm, 'chart.js', 'dist', 'chart.umd.js')));
  app.use('/vendor/leaflet', express.static(path.join(nm, 'leaflet', 'dist'), { maxAge: '7d' }));
  app.get('/map-picker', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'map-picker.html')));
  // Versi web aplikasi pelanggan (hasil `npm run build:web` di folder mobile) — untuk prototype/uji coba
  const webApp = path.join(__dirname, '..', 'public', 'app');
  app.use('/app', express.static(webApp, { index: 'index.html' }));
  app.use('/app', (req, res, next) => {
    if (req.method !== 'GET') return next();
    const index = path.join(webApp, 'index.html');
    if (!fs.existsSync(index)) return res.status(404).send('<h2 style="font-family:sans-serif">Versi web aplikasi belum dibuat. Jalankan <code>npm run demo</code> di folder utama.</h2>');
    res.sendFile(index); // rute aplikasi (mis. /app/cart) ditangani di sisi browser
  });
  app.get('/', (_req, res) => res.send(landing()));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Endpoint tidak ditemukan')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || 500;
    let message = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') [status, message] = [400, 'Ukuran gambar maksimal 5MB'];
    if (/UNIQUE constraint failed/.test(err.message)) [status, message] = [409, 'Data sudah ada (duplikat)'];
    if (/FOREIGN KEY constraint failed/.test(err.message)) [status, message] = [400, 'Data terkait tidak ditemukan / masih dipakai'];
    if (status >= 500) {
      console.error(err);
      if (!err.status) message = 'Terjadi kesalahan pada server';
    }
    if (req.path.startsWith('/api') || req.xhr || req.accepts(['json', 'html']) === 'json') {
      return res.status(status).json({ error: message, details: err.details });
    }
    res.status(status).send(`<h2 style="font-family:sans-serif">${message}</h2>`);
  });

  return app;
}

module.exports = { createApp };
