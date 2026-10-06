const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const env = process.env;

module.exports = {
  port: Number(env.PORT || 4000),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 4000}`).replace(/\/$/, ''),
  jwtSecret: env.JWT_SECRET || 'dev-secret-harum-group',
  adminEmail: env.ADMIN_EMAIL || 'admin@harumgroup.id',
  adminPassword: env.ADMIN_PASSWORD || 'admin123',
  dbFile: path.resolve(__dirname, '..', env.DB_FILE || './data/harum.db'),
  uploadDir: path.resolve(__dirname, '..', 'uploads'),
  payment: {
    provider: (env.PAYMENT_PROVIDER || 'simulator').toLowerCase(),
    midtrans: {
      serverKey: env.MIDTRANS_SERVER_KEY || '',
      clientKey: env.MIDTRANS_CLIENT_KEY || '',
      isProduction: env.MIDTRANS_IS_PRODUCTION === 'true',
    },
  },
};
