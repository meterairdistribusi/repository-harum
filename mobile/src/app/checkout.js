import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Field, Loading, OptionCard, Row, tap } from '../components/ui';
import { useAuth } from '../context/auth';
import { lineKey, useCart } from '../context/cart';
import { useStore } from '../context/store';
import { api } from '../lib/api';
import { notify } from '../lib/dialog';
import { km, rupiah } from '../lib/format';
import { colors, font, radius } from '../lib/theme';

const METHOD_UI = {
  qris: { icon: 'qr-code', hint: 'Bisa dibayar pakai GoPay, OVO, DANA, ShopeePay, LinkAja & semua m-banking' },
  bank_transfer: { icon: 'business', hint: 'Transfer ke nomor Virtual Account, otomatis terkonfirmasi' },
  ewallet: { icon: 'wallet', hint: 'Langsung buka aplikasi dompet digital Anda' },
  cash: { icon: 'cash', hint: 'Bayar tunai saat pesanan diterima' },
};

function Step({ n, title }) {
  return (
    <View style={s.step}>
      <View style={s.stepNum}>
        <Text style={s.stepNumText}>{n}</Text>
      </View>
      <Text style={s.stepTitle}>{title}</Text>
    </View>
  );
}

export default function Checkout() {
  const cart = useCart();
  const auth = useAuth();
  const { store } = useStore();
  const [deliveryChoice, setDelivery] = useState('delivery');
  const [addresses, setAddresses] = useState(null);
  const [addressId, setAddressId] = useState(null);
  const [method, setMethod] = useState('qris');
  const [channel, setChannel] = useState('qris');
  const [notes, setNotes] = useState('');
  const [quoteState, setQuote] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const placed = useRef(false);

  // Bila layanan antar dimatikan admin, otomatis ambil di toko
  const delivery = store && !store.delivery_enabled && store.pickup_enabled ? 'pickup' : deliveryChoice;

  // Muat alamat setiap kali layar tampil (agar alamat baru langsung muncul)
  useFocusEffect(
    useCallback(() => {
      if (!auth.user) return;
      api('/me/addresses')
        .then((r) => {
          setAddresses(r.data);
          setAddressId((cur) => (cur && r.data.some((a) => a.id === cur) ? cur : r.data.find((a) => a.is_default)?.id ?? r.data[0]?.id ?? null));
        })
        .catch(() => setAddresses([]));
    }, [auth.user])
  );

  const items = cart.items.map((i) => ({ product_id: i.product.id, variant_id: i.variant?.id, quantity: i.quantity }));
  const itemsKey = JSON.stringify(items);
  const quoteKey = JSON.stringify([itemsKey, delivery, delivery === 'delivery' ? addressId : null]);

  useEffect(() => {
    if (!auth.user) return;
    const key = quoteKey;
    api('/me/checkout/quote', { method: 'POST', body: { items: JSON.parse(itemsKey), delivery_method: delivery, address_id: delivery === 'delivery' ? addressId : undefined } })
      .then((r) => setQuote({ key, data: r.data }))
      .catch(() => {});
  }, [itemsKey, delivery, addressId, auth.user, quoteKey]);
  // Ringkasan lama disembunyikan selama ringkasan untuk pilihan terbaru sedang dihitung
  const quote = quoteState?.key === quoteKey ? quoteState.data : null;

  const pickMethod = (m) => {
    setMethod(m);
    const first = store.payment_methods.find((x) => x.code === m).channels[0].code;
    setChannel(first);
  };

  const submit = async () => {
    if (delivery === 'delivery' && !addressId) return notify('Alamat belum diisi', 'Tambahkan alamat pengiriman terlebih dahulu.');
    setSubmitting(true);
    try {
      const r = await api('/me/orders', {
        method: 'POST',
        body: { items, delivery_method: delivery, address_id: delivery === 'delivery' ? addressId : undefined, payment_method: method, payment_channel: channel, notes },
      });
      placed.current = true;
      // Tunai tidak perlu halaman pembayaran — langsung ke status pesanan
      router.replace(method === 'cash' ? `/order/${r.data.code}` : `/payment/${r.data.code}`);
      cart.clear();
    } catch (e) {
      notify('Pesanan gagal dibuat', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (placed.current) return;
    if (cart.ready && !cart.items.length) router.replace('/cart');
    else if (auth.ready && !auth.user) router.replace({ pathname: '/login', params: { next: '/checkout' } });
  }, [cart.ready, cart.items.length, auth.ready, auth.user]);

  if (!store || !addresses || !cart.items.length) return <Loading />;

  const methods = store.payment_methods;
  const currentMethod = methods.find((m) => m.code === method);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {/* 1. Pengiriman */}
        <Step n={1} title="Cara menerima pesanan" />
        {store.delivery_enabled && <OptionCard selected={delivery === 'delivery'} onPress={() => setDelivery('delivery')} icon="bicycle" title="Diantar ke rumah" subtitle={[store.shipping_mode === 'distance' ? 'Ongkir sesuai jarak' : `Ongkir ${rupiah(store.delivery_fee)}`, store.free_delivery_min ? `gratis min. ${rupiah(store.free_delivery_min)}` : ''].filter(Boolean).join(' · ')} />}
        {store.pickup_enabled && <OptionCard selected={delivery === 'pickup'} onPress={() => setDelivery('pickup')} icon="storefront" title="Ambil sendiri di toko" subtitle="Tanpa ongkir" />}

        {delivery === 'delivery' ? (
          <>
            <Text style={s.sub}>Alamat pengiriman</Text>
            {addresses.map((a) => (
              <OptionCard key={a.id} selected={addressId === a.id} onPress={() => setAddressId(a.id)} icon="location" title={`${a.label} · ${a.recipient}`} subtitle={`${a.phone}\n${a.address}${a.notes ? ` (${a.notes})` : ''}`} />
            ))}
            <Pressable
              style={s.addAddr}
              onPress={() => {
                tap();
                router.push('/address-form');
              }}
            >
              <Ionicons name="add-circle" size={22} color={colors.brand} />
              <Text style={s.addAddrText}>{addresses.length ? 'Tambah alamat lain' : 'Tambah alamat pengiriman'}</Text>
            </Pressable>
            {quote?.shipping_error ? (
              <View style={s.shipErr}>
                <Text style={s.shipErrText}>⚠️ {quote.shipping_error}</Text>
                {addressId ? <Button size="sm" variant="accent" icon="map" title="Tandai Lokasi di Peta" onPress={() => router.push({ pathname: '/address-form', params: { id: addressId } })} /> : null}
              </View>
            ) : quote?.distance_km != null ? (
              <Text style={s.distance}>
                📍 Jarak tempuh dari toko: <Text style={{ fontWeight: '800' }}>{km(quote.distance_km)}</Text>
                {quote.distance_estimated ? ' (perkiraan)' : ''}
              </Text>
            ) : null}
          </>
        ) : (
          <Card style={{ backgroundColor: colors.brandSoft }}>
            <Text style={{ fontWeight: '800', fontSize: font.md, color: colors.brandDark }}>📍 {store.store_name}</Text>
            <Text style={{ fontSize: font.md, color: colors.brandDark, marginTop: 4 }}>{store.store_address}</Text>
            <Text style={{ fontSize: font.sm, color: colors.brandDark, marginTop: 4 }}>Jam buka: {store.opening_hours}</Text>
          </Card>
        )}

        {/* 2. Pembayaran */}
        <Step n={2} title="Pilih cara bayar" />
        {methods.map((m) => (
          <OptionCard
            key={m.code}
            selected={method === m.code}
            onPress={() => pickMethod(m.code)}
            icon={METHOD_UI[m.code]?.icon}
            title={m.label}
            subtitle={m.code === 'cash' ? (delivery === 'delivery' ? 'Bayar tunai ke kurir saat pesanan sampai' : 'Bayar tunai di kasir saat ambil pesanan') : METHOD_UI[m.code]?.hint || m.description}
          />
        ))}
        {currentMethod && currentMethod.channels.length > 1 && (
          <>
            <Text style={s.sub}>Pilih {method === 'bank_transfer' ? 'bank' : 'e-wallet'}</Text>
            <View style={s.channels}>
              {currentMethod.channels.map((c) => {
                const active = channel === c.code;
                return (
                  <Pressable
                    key={c.code}
                    onPress={() => {
                      tap();
                      setChannel(c.code);
                    }}
                    style={[s.channel, active && s.channelActive]}
                  >
                    <Text style={[s.channelCode, active && { color: colors.white }]}>{c.code.toUpperCase()}</Text>
                    <Text style={[s.channelLabel, active && { color: 'rgba(255,255,255,.9)' }]} numberOfLines={1}>
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {/* 3. Catatan */}
        <Step n={3} title="Catatan (opsional)" />
        <Field value={notes} onChangeText={setNotes} placeholder="Contoh: es dibungkus terpisah, pagar warna hijau" multiline />

        {/* Ringkasan */}
        <Card>
          <Text style={{ fontSize: font.md, fontWeight: '800', marginBottom: 8, color: colors.ink }}>Ringkasan Belanja</Text>
          {cart.items.map((i) => (
            <Row key={lineKey(i.product.id, i.variant?.id)} label={`${i.quantity}× ${i.product.name}${i.variant ? ` (${i.variant.name})` : ''}`} value={rupiah(i.quantity * cart.priceOf(i))} />
          ))}
          <View style={s.divider} />
          <Row label="Subtotal" value={rupiah(quote?.subtotal ?? cart.subtotal)} />
          <Row
            label={quote?.distance_km != null ? `Ongkos kirim (${km(quote.distance_km)})` : 'Ongkos kirim'}
            value={!quote ? '…' : quote.shipping_error ? '-' : quote.delivery_fee ? rupiah(quote.delivery_fee) : 'GRATIS'}
            color={quote && !quote.delivery_fee && !quote.shipping_error ? colors.ok : undefined}
          />
          <View style={s.divider} />
          <Row label="Total Bayar" value={rupiah(quote?.total ?? cart.subtotal)} bold />
          {quote?.problems?.filter((p) => p.type !== 'shipping').map((p, i) => (
            <Text key={i} style={s.problem}>
              ⚠️ {p.message}
            </Text>
          ))}
        </Card>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={s.footer}>
        <Button
          title={`${method === 'cash' ? 'Pesan Sekarang' : 'Bayar Sekarang'} · ${rupiah(quote?.total ?? cart.subtotal)}`}
          icon={method === 'cash' ? 'checkmark-circle' : 'shield-checkmark'}
          variant="accent"
          loading={submitting}
          disabled={!store.is_open || !quote || !!quote.problems?.length}
          onPress={submit}
        />
        {!store.is_open && <Text style={s.problem}>Toko sedang tutup, belum bisa menerima pesanan.</Text>}
        <Text style={s.secure}>{method === 'cash' ? '💵 Siapkan uang tunai saat pesanan diterima' : '🔒 Pembayaran aman & otomatis terkonfirmasi'}</Text>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20, marginBottom: 12 },
  stepNum: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  stepNumText: { color: colors.white, fontWeight: '900', fontSize: font.md },
  stepTitle: { fontSize: font.lg, fontWeight: '800', color: colors.ink },
  sub: { fontSize: font.sm, fontWeight: '700', color: colors.muted, marginTop: 6, marginBottom: 8 },
  addAddr: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderRadius: radius.md, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.brand, justifyContent: 'center' },
  addAddrText: { color: colors.brand, fontWeight: '800', fontSize: font.md },
  channels: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  channel: { width: '31.5%', padding: 10, borderRadius: radius.sm, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.white, alignItems: 'center' },
  channelActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  channelCode: { fontSize: font.md, fontWeight: '900', color: colors.brandDark },
  channelLabel: { fontSize: 11, color: colors.muted, marginTop: 2 },
  shipErr: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: 12, marginTop: 10, gap: 10 },
  shipErrText: { color: '#991B1B', fontWeight: '700', fontSize: font.sm },
  distance: { color: colors.brandDark, fontSize: font.sm, marginTop: 10, textAlign: 'center' },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  problem: { color: colors.danger, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  footer: { backgroundColor: colors.white, padding: 16, borderTopWidth: 1, borderTopColor: colors.line },
  secure: { textAlign: 'center', color: colors.muted, fontSize: font.xs, marginTop: 8 },
});
