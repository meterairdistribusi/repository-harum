import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, ErrorView, Loading, Row } from '../../components/ui';
import { api } from '../../lib/api';
import { confirmAsync } from '../../lib/dialog';
import { dateTime, payLabel, PAYMENT_METHOD, rupiah } from '../../lib/format';
import { colors, font, radius } from '../../lib/theme';

// WebView hanya tersedia di Android/iOS
const WebView = Platform.OS === 'web' ? null : require('react-native-webview').WebView;



export default function Payment() {
  const { code } = useLocalSearchParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [webLoading, setWebLoading] = useState(true);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api(`/me/orders/${code}`);
      setOrder(r.data);
      setError(null);
      return r.data;
    } catch (e) {
      setError(e.message);
    }
  }, [code]);

  // Cek status pembayaran berkala selama masih menunggu
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loader async, setState terjadi setelah fetch
    load();
    timer.current = setInterval(async () => {
      const o = await load();
      if (o && o.status !== 'pending_payment') clearInterval(timer.current);
    }, 5000);
    return () => clearInterval(timer.current);
  }, [load]);

  const goOrder = () => router.replace(`/order/${code}`);

  if (error && !order) return <ErrorView message={error} onRetry={load} />;
  if (!order) return <Loading />;

  // ---------------------------------------------------- sudah dibayar
  if (order.payment_status === 'paid') {
    return (
      <SafeAreaView style={s.center} edges={['bottom']}>
        <Stack.Screen options={{ title: 'Pembayaran Berhasil', headerLeft: () => null }} />
        <View style={[s.bigIcon, { backgroundColor: colors.okSoft }]}>
          <Ionicons name="checkmark-circle" size={96} color={colors.ok} />
        </View>
        <Text style={s.title}>Pembayaran Berhasil!</Text>
        <Text style={s.subtitle}>Terima kasih 🙏 Pesanan Anda sedang kami siapkan.</Text>
        <Card style={{ alignSelf: 'stretch', marginVertical: 24 }}>
          <Row label="No. Pesanan" value={order.code} />
          <Row label="Metode" value={payLabel(order)} />
          <Row label="Total" value={rupiah(order.total)} bold />
        </Card>
        <Button style={{ alignSelf: 'stretch' }} title="Lihat Status Pesanan" icon="receipt" onPress={goOrder} />
        <Button style={{ alignSelf: 'stretch', marginTop: 10 }} variant="soft" title="Belanja Lagi" icon="home" onPress={() => router.replace('/')} />
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------- batal / kedaluwarsa
  if (order.status === 'cancelled') {
    return (
      <SafeAreaView style={s.center} edges={['bottom']}>
        <View style={[s.bigIcon, { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name="close-circle" size={96} color={colors.danger} />
        </View>
        <Text style={s.title}>Pesanan Dibatalkan</Text>
        <Text style={s.subtitle}>{order.payment_status === 'expired' ? 'Batas waktu pembayaran sudah habis.' : 'Pembayaran tidak diselesaikan.'} Silakan pesan kembali.</Text>
        <Button style={{ alignSelf: 'stretch', marginTop: 24 }} title="Belanja Lagi" icon="home" onPress={() => router.replace('/')} />
      </SafeAreaView>
    );
  }

  // ---------------------------------------------------- menunggu pembayaran
  const header = (
    <View style={s.head}>
      <View style={{ flex: 1 }}>
        <Text style={s.headLabel}>Total bayar</Text>
        <Text style={s.headTotal}>{rupiah(order.total)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.headLabel}>Bayar sebelum</Text>
        <Text style={s.headExp}>{dateTime(order.payment_expires_at)}</Text>
      </View>
    </View>
  );

  const cancel = async () => {
    if (!(await confirmAsync('Batalkan pesanan?', 'Pesanan ini akan dibatalkan.', 'Batalkan'))) return;
    await api(`/me/orders/${code}/cancel`, { method: 'POST' }).catch(() => {});
    load();
  };

  if (!WebView) {
    // Versi web: buka halaman pembayaran di tab baru, lalu status dicek otomatis
    return (
      <View style={{ flex: 1, padding: 16 }}>
        {header}
        <Card style={{ alignItems: 'center', gap: 12, marginTop: 16 }}>
          <ActivityIndicator color={colors.brand} />
          <Text style={s.subtitle}>Selesaikan pembayaran di halaman yang terbuka. Status akan diperbarui otomatis.</Text>
          <Button style={{ alignSelf: 'stretch' }} title="Buka Halaman Pembayaran" icon="open-outline" onPress={() => Linking.openURL(order.payment_url)} />
          <Button style={{ alignSelf: 'stretch' }} variant="soft" title="Saya Sudah Bayar" icon="refresh" onPress={load} />
          <Button style={{ alignSelf: 'stretch' }} variant="danger" title="Batalkan Pesanan" onPress={cancel} />
        </Card>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: `Bayar · ${PAYMENT_METHOD[order.payment_method]}` }} />
      <View style={{ padding: 16, paddingBottom: 8 }}>{header}</View>
      <View style={s.webWrap}>
        <WebView
          source={{ uri: order.payment_url }}
          onLoadEnd={() => setWebLoading(false)}
          setSupportMultipleWindows={false}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={(req) => {
            // Link aplikasi e-wallet (gojek://, shopeeid://, intent://) dibuka di aplikasinya
            if (!/^https?:\/\//.test(req.url)) {
              Linking.openURL(req.url).catch(() => {});
              return false;
            }
            if (req.url.includes(`/pay/${order.code}/finish`)) {
              load();
            }
            return true;
          }}
        />
        {webLoading && (
          <View style={s.webLoading}>
            <ActivityIndicator size="large" color={colors.brand} />
            <Text style={{ marginTop: 8, color: colors.muted }}>Menyiapkan pembayaran…</Text>
          </View>
        )}
      </View>
      <SafeAreaView edges={['bottom']} style={s.footer}>
        <Button size="sm" style={{ flex: 1 }} variant="soft" title="Cek Status" icon="refresh" onPress={load} />
        <Button size="sm" style={{ flex: 1 }} variant="outline" title="Bayar Nanti" icon="time-outline" onPress={goOrder} />
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  bigIcon: { width: 150, height: 150, borderRadius: 75, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  title: { fontSize: font.xxl, fontWeight: '900', color: colors.ink, textAlign: 'center' },
  subtitle: { fontSize: font.md, color: colors.muted, textAlign: 'center', marginTop: 8, lineHeight: 24 },
  head: { flexDirection: 'row', backgroundColor: colors.brand, borderRadius: radius.lg, padding: 16 },
  headLabel: { color: 'rgba(255,255,255,.85)', fontSize: font.sm },
  headTotal: { color: colors.white, fontSize: font.xl, fontWeight: '900' },
  headExp: { color: colors.white, fontSize: font.sm, fontWeight: '700', marginTop: 4 },
  webWrap: { flex: 1, marginHorizontal: 16, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.white },
  webLoading: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  footer: { flexDirection: 'row', gap: 10, padding: 16 },
});
