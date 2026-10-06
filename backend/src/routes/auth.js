const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { signToken, publicUser, authenticate } = require('../middleware/auth');
const { HttpError, asyncHandler, required, normalizePhone } = require('../utils');

const router = express.Router();

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    required(req.body, ['name', 'phone', 'password']);
    const name = String(req.body.name).trim();
    const phone = normalizePhone(req.body.phone);
    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : null;
    const password = String(req.body.password);
    if (!/^0\d{8,13}$/.test(phone)) throw new HttpError(400, 'Nomor HP tidak valid');
    if (password.length < 6) throw new HttpError(400, 'Kata sandi minimal 6 karakter');

    const d = db.get();
    if (d.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) throw new HttpError(409, 'Nomor HP sudah terdaftar, silakan masuk');
    if (email && d.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'Email sudah terdaftar');

    const hash = await bcrypt.hash(password, 10);
    const r = d.prepare('INSERT INTO users (name, phone, email, password_hash) VALUES (?, ?, ?, ?)').run(name, phone, email, hash);
    const user = publicUser(db.plain(d.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)));
    res.status(201).json({ token: signToken(user), user });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    required(req.body, ['login', 'password']);
    const login = String(req.body.login).trim();
    const d = db.get();
    const user = login.includes('@')
      ? d.prepare('SELECT * FROM users WHERE email = ?').get(login.toLowerCase())
      : d.prepare('SELECT * FROM users WHERE phone = ?').get(normalizePhone(login));
    if (!user || !(await bcrypt.compare(String(req.body.password), user.password_hash))) {
      throw new HttpError(401, 'Nomor HP/email atau kata sandi salah');
    }
    const u = publicUser(db.plain(user));
    res.json({ token: signToken(u), user: u });
  })
);

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

router.put(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const d = db.get();
    const name = req.body.name ? String(req.body.name).trim() : req.user.name;
    const email = req.body.email !== undefined ? String(req.body.email).trim().toLowerCase() || null : req.user.email;
    if (email && d.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?').get(email, req.user.id)) {
      throw new HttpError(409, 'Email sudah dipakai akun lain');
    }
    d.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name, email, req.user.id);
    if (req.body.new_password) {
      const current = d.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!(await bcrypt.compare(String(req.body.current_password || ''), current.password_hash))) {
        throw new HttpError(400, 'Kata sandi lama salah');
      }
      if (String(req.body.new_password).length < 6) throw new HttpError(400, 'Kata sandi minimal 6 karakter');
      d.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(String(req.body.new_password), 10), req.user.id);
    }
    res.json({ user: publicUser(db.plain(d.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id))) });
  })
);

module.exports = router;
