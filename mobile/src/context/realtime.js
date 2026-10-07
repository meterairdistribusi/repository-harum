import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { BASE_URL, getToken } from '../lib/api';
import { useAuth } from './auth';

const RealtimeContext = createContext({ versions: {}, connected: false });

/**
 * Terhubung ke backend lewat WebSocket. Setiap kali admin mengubah sub menu, kategori,
 * banner atau pengaturan — atau status pesanan berubah — "versi" terkait naik, dan layar
 * yang memakainya otomatis memuat ulang data.
 */
export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const [versions, setVersions] = useState({ products: 0, categories: 0, banners: 0, store: 0, orders: 0 });
  const [connected, setConnected] = useState(false);
  const [lastOrder, setLastOrder] = useState(null);
  const retry = useRef(1000);

  useEffect(() => {
    let ws = null;
    let timer = null;
    let stopped = false;
    const bump = (...keys) => setVersions((v) => Object.fromEntries(Object.entries(v).map(([k, n]) => [k, keys.includes(k) ? n + 1 : n])));

    const connect = () => {
      if (stopped || ws) return;
      const token = getToken();
      ws = new WebSocket(`${BASE_URL.replace(/^http/, 'ws')}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`);
      ws.onopen = () => {
        retry.current = 1000;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.type === 'hello') bump('products', 'categories', 'banners', 'store', 'orders'); // segarkan setelah tersambung ulang
        if (m.type === 'catalog') bump(m.scope);
        if (m.type === 'order') {
          setLastOrder(m);
          bump('orders');
        }
      };
      ws.onclose = () => {
        ws = null;
        setConnected(false);
        if (!stopped) timer = setTimeout(connect, (retry.current = Math.min(retry.current * 2, 30000)));
      };
      ws.onerror = () => ws?.close();
    };
    connect();

    // Sambung ulang segera saat aplikasi dibuka lagi dari latar belakang
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !ws) {
        clearTimeout(timer);
        retry.current = 1000;
        connect();
      }
    });
    return () => {
      stopped = true;
      clearTimeout(timer);
      sub.remove();
      ws?.close();
    };
  }, [user?.id]); // sambung ulang dengan token baru saat masuk/keluar

  const value = useMemo(() => ({ versions, connected, lastOrder }), [versions, connected, lastOrder]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);

/** Versi data tertentu, mis. useVersion('products'), untuk dipakai sebagai dependensi effect. */
export const useVersion = (key) => useContext(RealtimeContext).versions[key] || 0;
