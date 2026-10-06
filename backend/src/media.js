const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('./config');
const { HttpError } = require('./utils');

/** Ubah path relatif "/uploads/x.jpg" menjadi URL absolut sesuai host yang diakses klien. */
function absUrl(req, url) {
  if (!url || /^https?:\/\//.test(url)) return url;
  return `${req.protocol}://${req.get('host')}${url}`;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, 'File harus gambar JPG/PNG/WEBP'));
  },
});

module.exports = { absUrl, upload };
