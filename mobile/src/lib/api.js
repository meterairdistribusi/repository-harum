import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Alamat backend. Urutan prioritas:
 *  1. EXPO_PUBLIC_API_URL (mis. https://api.harumgroup.id)
 *  2. app.json -> expo.extra.apiUrl
 *  3. Saat development: IP komputer yang menjalankan Expo + port 4000
 */
function resolveBaseUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const fromConfig = Constants.expoConfig?.extra?.apiUrl;
  if (fromConfig) return fromConfig.replace(/\/$/, '');
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:4000`;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host) return `http://${host}:4000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000';
}

export const BASE_URL = resolveBaseUrl();

let authToken = null;
let onUnauthorized = null;

export function setToken(t) {
  authToken = t;
}
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let res;
  try {
    res = await fetch(`${BASE_URL}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && authToken && onUnauthorized) onUnauthorized();
  if (!res.ok) throw new ApiError(data.error || 'Terjadi kesalahan, coba lagi.', res.status);
  return data;
}
