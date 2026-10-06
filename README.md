# Harum Group — Aplikasi Belanja Online

Sistem pemesanan online untuk produk **Harum Group**: es kristal, es buah, es serut, frozen food, dan makanan siap saji.

| Bagian | Folder | Teknologi | Untuk siapa |
|---|---|---|---|
| Aplikasi pelanggan (Android & iPhone) | [`mobile/`](mobile) | Expo / React Native (satu kode untuk Android + iOS) | Pembeli |
| Backend API + Panel Admin web | [`backend/`](backend) | Node.js 22, Express, SQLite | Pemilik & karyawan toko |

![Aplikasi mobile](docs/aplikasi-mobile.png)

## Fitur

**Aplikasi pelanggan**
- Tampilan sederhana dengan huruf & tombol besar, ramah untuk semua umur
- Beranda: banner promo, 5 lini bisnis (kategori), produk terlaris, status toko buka/tutup
- Cari produk, filter per kategori, detail produk & stok
- Keranjang tersimpan di HP, info "kurang Rp… lagi untuk gratis ongkir"
- Checkout 3 langkah: **diantar / ambil di toko** → **cara bayar** → catatan
- Pembayaran **QRIS**, **Transfer Bank (Virtual Account BCA, BNI, BRI, Mandiri, Permata)**, **E-Wallet (GoPay, ShopeePay)**; QRIS juga bisa dibayar pakai OVO, DANA, LinkAja & semua m-banking
- Status pembayaran terkonfirmasi otomatis, lacak status pesanan (dibayar → disiapkan → diantar/siap diambil → selesai)
- Riwayat pesanan, pesan lagi, simpan banyak alamat, tanya toko via WhatsApp
- Daftar cukup nama + nomor HP

**Panel admin** (`http://<server>:4000/admin`)
- Dashboard: omzet hari ini & bulan ini, grafik 7 hari, penjualan per lini bisnis, produk terlaris, stok menipis
- Kelola pesanan: filter status, cari, ubah status, konfirmasi bayar manual, batalkan (stok kembali otomatis), tombol WhatsApp pelanggan; notifikasi bunyi saat ada pesanan baru dibayar
- Produk & stok (upload foto, harga, satuan, produk unggulan, ubah stok langsung di tabel)
- Kategori, banner promo, daftar pelanggan
- Pengaturan: nama toko, jam buka, buka/tutup toko, ongkir, gratis ongkir, minimal belanja, batas waktu bayar

![Panel admin](docs/panel-admin.png)

## Menjalankan di komputer (development)

Butuh **Node.js 22.5+**.

### 1. Backend + panel admin

```bash
cd backend
cp .env.example .env      # lalu sesuaikan isinya
npm install
npm start
```

- API: `http://localhost:4000/api`
- Panel admin: `http://localhost:4000/admin` — login awal `admin@harumgroup.id` / `admin123` (**ganti** lewat `.env` sebelum dipakai sungguhan)
- Saat pertama jalan, database diisi contoh katalog Harum Group (bisa diubah/hapus dari panel admin).
- Tes otomatis: `npm test`

### 2. Aplikasi mobile

```bash
cd mobile
npm install
npx expo start
```

Scan QR yang muncul dengan aplikasi **Expo Go** (Android/iPhone). HP dan komputer harus di jaringan Wi-Fi yang sama — aplikasi otomatis memakai IP komputer port 4000 sebagai alamat backend. Untuk backend di server lain, isi `EXPO_PUBLIC_API_URL` (lihat `mobile/.env.example`).

Cek kode: `npm run lint`.

## Pembayaran (QRIS, Transfer, E-Wallet)

Backend memakai payment gateway **Midtrans** (resmi Bank Indonesia, mendukung QRIS, Virtual Account, GoPay, ShopeePay). Ada 2 mode di `backend/.env`:

| `PAYMENT_PROVIDER` | Kegunaan |
|---|---|
| `simulator` (bawaan) | Uji coba tanpa uang sungguhan. Halaman bayar menampilkan QR / nomor VA contoh dan tombol "Simulasikan Pembayaran Berhasil". **Jangan dipakai di produksi.** |
| `midtrans` | Pembayaran sungguhan |

Langkah mengaktifkan Midtrans:
1. Daftar di <https://dashboard.midtrans.com>, lengkapi data usaha.
2. Ambil **Server Key** & **Client Key** (Settings → Access Keys). Mulai dengan mode *Sandbox* untuk uji coba.
3. Isi di `backend/.env`:
   ```
   PAYMENT_PROVIDER=midtrans
   MIDTRANS_SERVER_KEY=SB-Mid-server-xxxx
   MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxx
   MIDTRANS_IS_PRODUCTION=false   # ubah ke true setelah akun production disetujui
   PUBLIC_URL=https://api.harumgroup.id
   ```
4. Di dashboard Midtrans → Settings → Payment → *Notification URL*, isi:
   `https://api.harumgroup.id/api/payments/midtrans/notification`
5. Aktifkan channel QRIS, GoPay, ShopeePay dan Virtual Account yang diinginkan di dashboard Midtrans.

Alur: pelanggan pilih metode → backend membuat transaksi Midtrans → aplikasi membuka halaman pembayaran → Midtrans mengirim notifikasi (diverifikasi signature SHA-512) → pesanan otomatis berstatus **Pembayaran Diterima**. Pesanan yang tidak dibayar sampai batas waktu otomatis dibatalkan dan stok dikembalikan.

## Menerbitkan ke Play Store & App Store

1. Siapkan backend di server/VPS dengan domain HTTPS (mis. `https://api.harumgroup.id`), jalankan dengan `NODE_ENV=production`, isi `JWT_SECRET` acak yang panjang, dan **backup file database** (`backend/data/harum.db`) & folder `backend/uploads` secara rutin.
2. Ubah `EXPO_PUBLIC_API_URL` di `mobile/eas.json` ke domain backend Anda.
3. Ganti ikon & splash di `mobile/assets/` dengan logo Harum Group.
4. Build di cloud dengan EAS (tidak perlu Android Studio / Mac):
   ```bash
   cd mobile
   npx eas-cli@latest login
   npx eas-cli@latest build -p android --profile preview      # APK untuk dicoba di HP
   npx eas-cli@latest build -p android --profile production   # AAB untuk Play Store
   npx eas-cli@latest build -p ios --profile production       # untuk App Store (butuh Apple Developer)
   npx eas-cli@latest submit -p android   # / -p ios
   ```
   Butuh akun Google Play Console (sekali bayar) dan Apple Developer Program (tahunan).

## Struktur kode

```
backend/
  src/server.js            entry point (port 4000)
  src/app.js               rute Express
  src/db.js                skema SQLite
  src/routes/              auth, katalog, pelanggan (/api/me), admin (/api/admin), pembayaran (/pay, webhook)
  src/services/orders.js   logika pesanan, stok, status
  src/services/payment.js  integrasi Midtrans + simulator
  public/admin/            panel admin (HTML/CSS/JS, tanpa build)
  test/                    tes API end-to-end (npm test)
mobile/
  src/app/                 layar-layar (Expo Router): (tabs)/ beranda, belanja, keranjang, pesanan, akun; checkout, payment, order, login, ...
  src/components/ui.js     komponen UI (tombol besar, kartu produk, stepper jumlah, dll)
  src/context/             sesi login, keranjang, info toko
  src/lib/                 API client, tema warna, format rupiah
```

## Ringkasan API

| Method & path | Keterangan |
|---|---|
| `POST /api/auth/register`, `POST /api/auth/login`, `GET/PUT /api/auth/me` | Akun |
| `GET /api/store`, `/api/categories`, `/api/products?category=&q=&featured=1`, `/api/products/:id`, `/api/banners` | Katalog (publik) |
| `GET/POST/PUT/DELETE /api/me/addresses` | Alamat pelanggan |
| `POST /api/me/checkout/quote` | Hitung subtotal, ongkir, total |
| `POST /api/me/orders`, `GET /api/me/orders`, `GET /api/me/orders/:code`, `POST /api/me/orders/:code/cancel` | Pesanan pelanggan |
| `POST /api/payments/midtrans/notification` | Webhook Midtrans |
| `/api/admin/*` | stats, orders, products, categories, banners, customers, settings (khusus admin) |
