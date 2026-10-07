/**
 * Perhitungan ongkir.
 *  - flat     : tarif tetap (delivery_fee)
 *  - distance : tarif dasar + tarif per km, berdasarkan JARAK TEMPUH JALAN dari lokasi toko
 *               ke titik alamat pelanggan di peta.
 *
 * Sumber jarak (urutan): Google Distance Matrix (bila GOOGLE_MAPS_API_KEY diisi) ->
 * OSRM / OpenStreetMap (gratis) -> perkiraan garis lurus x 1,3 bila layanan peta tidak bisa dihubungi.
 */
const config = require('../config');
const { HttpError } = require('../utils');

const cache = new Map();

function haversineKm(a, b) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function googleKm(from, to) {
  const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
  url.searchParams.set('origins', `${from.lat},${from.lng}`);
  url.searchParams.set('destinations', `${to.lat},${to.lng}`);
  url.searchParams.set('mode', 'driving');
  url.searchParams.set('key', config.maps.googleKey);
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  const d = await r.json();
  const el = d.rows?.[0]?.elements?.[0];
  if (el?.status !== 'OK') throw new Error('google: ' + (el?.status || d.status));
  return el.distance.value / 1000;
}

async function osrmKm(from, to) {
  const url = `${config.maps.osrmUrl}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
  const d = await r.json();
  if (d.code !== 'Ok' || !d.routes?.length) throw new Error('osrm: ' + d.code);
  return d.routes[0].distance / 1000;
}

/** Jarak tempuh (km) beserta sumbernya. Hasil di-cache per pasangan koordinat. */
async function routeDistance(from, to) {
  const key = [from.lat, from.lng, to.lat, to.lng].map((x) => Number(x).toFixed(5)).join(',');
  if (cache.has(key)) return cache.get(key);
  let result;
  try {
    const km = config.maps.googleKey ? await googleKm(from, to) : await osrmKm(from, to);
    result = { km, source: config.maps.googleKey ? 'google' : 'osrm', estimated: false };
  } catch (err) {
    console.warn('[ongkir] layanan peta gagal, pakai perkiraan:', err.message);
    return { km: haversineKm(from, to) * 1.3, source: 'estimate', estimated: true }; // tidak di-cache
  }
  if (cache.size > 5000) cache.clear();
  cache.set(key, result);
  return result;
}

/** Tarif per jarak: tarif dasar untuk N km pertama, lalu per km (dibulatkan ke atas). */
function feeForDistance(km, s) {
  const extraKm = Math.max(0, Math.ceil(km - s.shipping_base_km - 1e-9));
  return s.shipping_base_fee + extraKm * s.shipping_per_km;
}

/**
 * Hitung ongkir untuk satu pesanan.
 * @returns {Promise<{fee:number, distance_km:number|null, estimated:boolean}>}
 */
async function quote({ subtotal, method, address, settings: s }) {
  if (method !== 'delivery') return { fee: 0, distance_km: null, estimated: false };
  const free = s.free_delivery_min > 0 && subtotal >= s.free_delivery_min;
  const storeSet = s.store_lat !== null && s.store_lng !== null;

  if (s.shipping_mode !== 'distance' || !storeSet) {
    return { fee: free ? 0 : s.delivery_fee, distance_km: null, estimated: false };
  }
  if (!address || address.lat == null || address.lng == null) {
    throw new HttpError(400, 'Tandai lokasi alamat Anda di peta agar ongkir bisa dihitung');
  }
  const d = await routeDistance({ lat: s.store_lat, lng: s.store_lng }, { lat: address.lat, lng: address.lng });
  const km = Math.round(d.km * 10) / 10;
  if (s.shipping_max_km > 0 && km > s.shipping_max_km) {
    throw new HttpError(400, `Maaf, alamat di luar jangkauan pengiriman (${km} km, maksimal ${s.shipping_max_km} km). Silakan pilih ambil di toko.`);
  }
  return { fee: free ? 0 : feeForDistance(km, s), distance_km: km, estimated: d.estimated };
}

module.exports = { quote, routeDistance, feeForDistance, haversineKm };
