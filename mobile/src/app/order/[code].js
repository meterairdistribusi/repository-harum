import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorView, Loading, ProductImage, Row, StatusBadge } from '../../components/ui';
import { useCart } from '../../context/cart';
import { useStore } from '../../context/store';
import { api } from '../../lib/api';
import { dateTime, payLabel, rupiah } from '../../lib/format';
import { colors, font, STATUS } from '../../lib/theme';

function stepsFor(order) {
  return ['pending_payment', 'paid', 'processing', order.delivery_method === 'delivery' ? 'shipping' : 'ready_pickup', 'completed'];
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

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loader async, setState terjadi setelah fetch
    load();
    const t = setInterval(load, 15000); // status diperbarui otomatis
    return () => clearInterval(t);
  }, [load]);

  if (error && !o) return <ErrorView message={error} onRetry={load} />;
  if (!o) return <Loading />;

  const steps = stepsFor(o);
  const currentIdx = steps.indexOf(o.status);
  const whenOf = (st) => o.history.find((h) => h.status === st)?.created_at;

  const buyAgain = async () => {
    const r = await api('/products');
    for (const it of o.items) {
      const p = r.data.find((x) => x.id === it.product_id);
      if (p && p.stock > 0) cart.setQty(p, Math.min(it.quantity, p.stock));
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
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={s.code} numberOfLines={1} adjustsFontSizeToFit>
            {o.code}
          </Text>
          <StatusBadge status={o.status} />
        </View>
        <Text style={s.muted}>Dipesan {dateTime(o.created_at)}</Text>
        {o.status === 'pending_payment' && <Button style={{ marginTop: 14 }} variant="accent" title="Bayar Sekarang" icon="wallet" onPress={() => router.push(`/payment/${o.code}`)} />}
      </Card>

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
        <Row label="Ongkos kirim" value={o.delivery_fee ? rupiah(o.delivery_fee) : 'GRATIS'} />
        <Row label="Total" value={rupiah(o.total)} bold />
        <Row label="Pembayaran" value={payLabel(o)} />
        {o.paid_at ? <Row label="Dibayar" value={dateTime(o.paid_at)} color={colors.ok} /> : null}
      </Card>

      {wa ? <Button variant="outline" icon="logo-whatsapp" title="Tanya Toko via WhatsApp" onPress={() => Linking.openURL(`https://wa.me/${wa}?text=${encodeURIComponent(`Halo Harum Group, saya mau tanya pesanan ${o.code}`)}`)} /> : null}
      {['completed', 'cancelled'].includes(o.status) && <Button variant="soft" icon="repeat" title="Pesan Lagi" onPress={buyAgain} />}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  code: { fontSize: font.lg, fontWeight: '900', color: colors.ink, flexShrink: 1, marginRight: 8 },
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
