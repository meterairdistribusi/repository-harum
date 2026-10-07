import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { BASE_URL } from '../lib/api';
import { colors, radius } from '../lib/theme';

const WebView = Platform.OS === 'web' ? null : require('react-native-webview').WebView;

/**
 * Peta OpenStreetMap untuk menandai titik alamat. Halaman peta disajikan oleh backend
 * (/map-picker) lalu ditampilkan lewat WebView (HP) atau iframe (web).
 * Props: lat, lng (titik awal), center ({lat,lng} bila belum ada titik), store ({lat,lng}),
 *        onPick({lat,lng}), onAddress(text), reloadKey (ubah untuk memusatkan ulang peta).
 */
export default function MapPicker({ lat, lng, center, store, onPick, onAddress, reloadKey = 0, height = 300 }) {
  const [loading, setLoading] = useState(true);
  const frame = useRef(null);
  const handlers = useRef({ onPick, onAddress });
  useEffect(() => {
    handlers.current = { onPick, onAddress };
  });

  // URL hanya dibentuk ulang saat reloadKey berubah, agar peta tidak berkedip setiap titik dipilih
  const [url, setUrl] = useState(() => buildUrl(lat, lng, center, store));
  const [lastKey, setLastKey] = useState(reloadKey);
  if (reloadKey !== lastKey) {
    setLastKey(reloadKey);
    setUrl(buildUrl(lat, lng, center, store));
  }

  const handle = (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'pick') handlers.current.onPick?.({ lat: msg.lat, lng: msg.lng });
      if (msg.type === 'address') handlers.current.onAddress?.(msg.address);
    } catch {}
  };

  useEffect(() => {
    if (WebView) return;
    const listener = (e) => {
      if (frame.current && e.source === frame.current.contentWindow) handle(e.data);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  return (
    <View style={[s.wrap, { height }]}>
      {WebView ? (
        <WebView key={url} source={{ uri: url }} onMessage={(e) => handle(e.nativeEvent.data)} onLoadEnd={() => setLoading(false)} nestedScrollEnabled originWhitelist={['*']} />
      ) : (
        <iframe key={url} ref={frame} src={url} title="Peta" onLoad={() => setLoading(false)} style={{ border: 0, width: '100%', height: '100%' }} />
      )}
      {loading && (
        <View style={s.loading} pointerEvents="none">
          <ActivityIndicator color={colors.brand} />
        </View>
      )}
    </View>
  );
}

function buildUrl(lat, lng, center, store) {
  const q = new URLSearchParams();
  if (lat != null && lng != null) {
    q.set('lat', lat);
    q.set('lng', lng);
  } else if (center) {
    q.set('clat', center.lat);
    q.set('clng', center.lng);
  }
  if (store) {
    q.set('slat', store.lat);
    q.set('slng', store.lng);
  }
  return `${BASE_URL}/map-picker?${q}`;
}

const s = StyleSheet.create({
  wrap: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.brandSoft, borderWidth: 1.5, borderColor: colors.line },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
