const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');

/** Pastikan akun admin awal tersedia. */
function ensureAdmin() {
  const d = db.get();
  const exists = d.prepare(`SELECT 1 FROM users WHERE role = 'admin'`).get();
  if (exists) return false;
  d.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')`).run(
    'Admin Harum Market',
    config.adminEmail.toLowerCase(),
    bcrypt.hashSync(config.adminPassword, 10)
  );
  console.log(`[setup] Akun admin dibuat: ${config.adminEmail} / ${config.adminPassword} (segera ganti!)`);
  return true;
}

module.exports = { ensureAdmin };
