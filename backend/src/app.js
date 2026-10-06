const path = require('node:path');
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { HttpError } = require('./utils');

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
  app.get('/', (_req, res) => res.redirect('/admin/'));

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
