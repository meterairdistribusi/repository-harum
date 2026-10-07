import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorView, Loading, ProductImage, Row, StatusBadge } from '../../components/ui';
import { useCart } from '../../context/cart';
import { useVersion } from '../../context/realtime';
import { useStore } from '../../context/store';
import { api } from '../../lib/api';
import { dateTime, km, payLabel, rupiah } from '../../lib/format';
import { colors, font, STATUS } from '../../lib/theme';

function stepsFor(order) {
  const last = [order.delivery_method === 'delivery' ? 'shipping' : 'ready_pickup', 'completed'];
  // Pesanan tunai tidak melewati tahap pembayaran online
  return order.payment_method === 'cash' ? ['processing', ...last] : ['pending_payment', 'paid', 'processing', ...last];
}

export default function OrderDetail() {
  const { code } = useLocalSearchParams();
  const { store } = useStore();
  const cart = useCart();
  const [o, setO] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setO((await api(`/me/orders/${code}`)).data);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [code]);

  // Status diperbarui seketika lewat koneksi realtime (+ cek berkala sebagai cadangan)
  const ordersV = useVersion('orders');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loader async, setState terjadi setelah fetch
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load, ordersV]);

  if (error && !o) return <ErrorView message={error} onRetry={load} />;
  if (!o) return <Loading />;

  const steps = stepsFor(o);
  const currentIdx = steps.indexOf(o.status);
  const whenOf = (st) => o.history.find((h) => h.status === st)?.created_at;

  const buyAgain = async () => {
    const ids = [...new Set(o.items.map((i) => i.product_id).filter(Boolean))].join(',');
    const r = ids ? await api(`/products?ids=${ids}`) : { data: [] };
    for (const it of o.items) {
      const p = r.data.find((x) => x.id === it.product_id);
      if (!p) continue;
      const v = p.has_variants ? p.variants.find((x) => x.id === it.variant_id) : null;
      if (p.has_variants && !v) continue;
      const stock = (v || p).stock;
      if (stock > 0) cart.setQty(p, v, Math.min(it.quantity, stock));
    }
    router.push('/cart');
  };

  const wa = store?.store_phone?.replace(/^0/, '62');

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <Card>
        <StatusBadge status={o.status} />
        <Text style={s.code} numberOfLines={1} adjustsFontSizeToFit>
          {o.code}
        </Text>
        <Text style={s.muted}>Dipesan {dateTime(o.created_at)}</Text>
        {o.status === 'pending_payment' && <Button style={{ marginTop: 14 }} variant="accent" title="Bayar Sekarang" icon="wallet" onPress={() => router.push(`/payment/${o.code}`)} />}
      </Card>

      {o.payment_method === 'cash' && o.payment_status !== 'paid' && o.status !== 'cancelled' && (
        <Card style={{ backgroundColor: colors.okSoft, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Text style={{ fontSize: 34 }}>💵</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: font.md, fontWeight: '800', color: '#166534' }}>Siapkan uang tunai {rupiah(o.total)}</Text>
            <Text style={{ fontSize: font.sm, color: '#166534', marginTop: 2 }}>{o.delivery_method === 'delivery' ? 'Dibayar ke kurir saat pesanan sampai.' : 'Dibayar di kasir saat mengambil pesanan.'}</Text>
          </View>
        </Card>
      )}

      {o.status !== 'cancelled' ? (
        <Card>
          <Text style={s.h}>Status Pesanan</Text>
          {steps.map((st, i) => {
            const done = i <= currentIdx;
            const meta = STATUS[st];
            return (
              <View key={st} style={s.step}>
                <View style={{ alignItems: 'center' }}>
                  <View style={[s.dot, done && { backgroundColor: colors.ok }]}>
                    <Ionicons name={done ? 'checkmark' : meta.icon} size={18} color={done ? colors.white : '#94A3B8'} />
                  </View>
                  {i < steps.length - 1 && <View style={[s.line, i < currentIdx && { backgroundColor: colors.ok }]} />}
                </View>
                <View style={{ flex: 1, paddingBottom: 18 }}>
                  <Text style={[s.stepTitle, !done && { color: '#94A3B8' }, i === currentIdx && { color: colors.ink }]}>{meta.label}</Text>
                  {whenOf(st) ? <Text style={s.muted}>{dateTime(whenOf(st))}</Text> : null}
                </View>
              </View>
            );
          })}
        </Card>
      ) : (
        <Card style={{ backgroundColor: colors.dangerSoft }}>
          <Text style={[s.h, { color: colors.danger }]}>Pesanan dibatalkan</Text>
          <Text style={{ color: '#991B1B', fontSize: font.md }}>{o.history.filter((h) => h.status === 'cancelled').pop()?.note}</Text>
        </Card>
      )}

      <Card>
        <Text style={s.h}>{o.delivery_method === 'delivery' ? '🛵 Diantar ke' : '🏪 Ambil di toko'}</Text>
        {o.delivery_method === 'delivery' ? (
          <>
            <Text style={s.body}>
              {o.recipient} · {o.phone}
            </Text>
            <Text style={s.body}>{o.address}</Text>
          </>
        ) : (
          <>
            <Text style={s.body}>{store?.store_address}</Text>
            <Text style={s.muted}>Jam buka {store?.opening_hours}</Text>
          </>
        )}
        {o.notes ? <Text style={[s.muted, { marginTop: 6 }]}>Catatan: {o.notes}</Text> : null}
      </Card>

      <Card>
        <Text style={s.h}>Rincian Belanja</Text>
        {o.items.map((i) => (
          <View key={i.id} style={s.item}>
            <ProductImage product={{ image_url: i.image_url, category_icon: '🛍️' }} size={52} />
            <View style={{ flex: 1 }}>
              <Text style={s.itemName}>{i.name}</Text>
              <Text style={s.muted}>
                {i.quantity} × {rupiah(i.price)}
              </Text>
            </View>
            <Text style={s.itemSub}>{rupiah(i.subtotal)}</Text>
          </View>
        ))}
        <View style={s.divider} />
        <Row label="Subtotal" value={rupiah(o.subtotal)} />
        <Row label={o.distance_km != null ? `Ongkos kirim (${km(o.distance_km)})` : 'Ongkos kirim'} value={o.delivery_fee ? rupiah(o.delivery_fee) : 'GRATIS'} />
        <Row label="Total" value={rupiah(o.total)} bold />
        <Row label="Pembayaran" value={payLabel(o)} />
        {o.paid_at ? <Row label="Dibayar" value={dateTime(o.paid_at)} color={colors.ok} /> : null}
      </Card>

      {wa ? <Button variant="outline" icon="logo-whatsapp" title="Tanya Toko via WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${wa}?text=${encodeURIComponent(`Halo Harum Market, saya mau tanya pesanan ${o.code}`)}`)} /> : null}
      {['completed', 'cancelled'].includes(o.status) && <Button variant="soft" icon="repeat" title="Pesan Lagi" onPress={buyAgain} />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  code: { fontSize: font.lg, fontWeight: '900', color: colors.ink, marginTop: 10 },
  muted: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  h: { fontSize: font.md, fontWeight: '800', color: colors.ink, marginBottom: 10 },
  body: { fontSize: font.md, color: colors.ink, lineHeight: 24 },
  step: { flexDirection: 'row', gap: 12 },
  dot: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  line: { width: 3, flex: 1, backgroundColor: colors.line, marginVertical: 2 },
  stepTitle: { fontSize: font.md, fontWeight: '700', color: colors.muted, marginTop: 6 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  itemName: { fontSize: font.md, fontWeight: '700', color: colors.ink },
  itemSub: { fontSize: font.md, fontWeight: '800', color: colors.ink },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
});
