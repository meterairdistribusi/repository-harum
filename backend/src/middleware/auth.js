const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { HttpError } = require('../utils');

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: '30d' });
}

function publicUser(u) {
  if (!u) return u;
  const { password_hash, ...rest } = u;
  return rest;
}

function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Silakan masuk terlebih dahulu'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = db.plain(db.get().prepare('SELECT * FROM users WHERE id = ?').get(payload.sub));
    if (!user) throw new Error('user not found');
    req.user = publicUser(user);
    next();
  } catch {
    next(new HttpError(401, 'Sesi berakhir, silakan masuk kembali'));
  }
}

function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') return next(new HttpError(403, 'Khusus admin'));
  next();
}

module.exports = { signToken, publicUser, authenticate, requireAdmin };
