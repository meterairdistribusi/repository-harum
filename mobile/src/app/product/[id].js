import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorView, Loading, ProductImage, QtyStepper } from '../../components/ui';
import { useCart } from '../../context/cart';
import { api } from '../../lib/api';
import { rupiah } from '../../lib/format';
import { colors, font, radius } from '../../lib/theme';

export default function ProductDetail() {
  const { id } = useLocalSearchParams();
  const cart = useCart();
  const [p, setP] = useState(null);
  const [error, setError] = useState(null);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    api(`/products/${id}`)
      .then((r) => {
        setP(r.data);
        const inCart = cart.qtyOf(r.data.id);
        if (inCart) setQty(inCart);
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error) return <ErrorView message={error} onRetry={() => router.back()} />;
  if (!p) return <Loading />;

  const inCart = cart.qtyOf(p.id);
  const soldOut = p.stock <= 0;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: p.category_name }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <ProductImage product={p} style={{ borderRadius: radius.lg }} />
        <Text style={s.name}>{p.name}</Text>
        <Text style={s.price}>
          {rupiah(p.price)} <Text style={s.unit}>/ {p.unit}</Text>
        </Text>
        <View style={[s.stock, soldOut && { backgroundColor: colors.dangerSoft }]}>
          <Text style={[s.stockText, soldOut && { color: colors.danger }]}>{soldOut ? 'Stok habis' : p.stock <= 10 ? `Sisa ${p.stock} ${p.unit} — segera pesan!` : `Stok tersedia`}</Text>
        </View>
        {p.description ? (
          <>
            <Text style={s.h}>Deskripsi</Text>
            <Text style={s.desc}>{p.description}</Text>
          </>
        ) : null}
      </ScrollView>

      {!soldOut && (
        <SafeAreaView edges={['bottom']} style={s.footer}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <Text style={s.qtyLabel}>Jumlah</Text>
            <QtyStepper value={qty} max={p.stock} onChange={(n) => setQty(Math.max(1, n))} />
          </View>
          <Button
            icon="cart"
            title={`${inCart ? 'Perbarui' : 'Masukkan'} Keranjang · ${rupiah(p.price * qty)}`}
            onPress={() => {
              cart.setQty(p, qty);
              router.back();
            }}
          />
        </SafeAreaView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  name: { fontSize: font.xl, fontWeight: '900', color: colors.ink, marginTop: 16 },
  price: { fontSize: font.xl, fontWeight: '800', color: colors.brandDark, marginTop: 6 },
  unit: { fontSize: font.md, color: colors.muted, fontWeight: '500' },
  stock: { alignSelf: 'flex-start', backgroundColor: colors.okSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, marginTop: 10 },
  stockText: { color: '#166534', fontWeight: '700', fontSize: font.sm },
  h: { fontSize: font.md, fontWeight: '800', marginTop: 20, color: colors.ink },
  desc: { fontSize: font.md, color: '#334155', lineHeight: 26, marginTop: 6 },
  footer: { backgroundColor: colors.white, padding: 16, borderTopWidth: 1, borderTopColor: colors.line },
  qtyLabel: { fontSize: font.md, fontWeight: '700', color: colors.ink },
});
