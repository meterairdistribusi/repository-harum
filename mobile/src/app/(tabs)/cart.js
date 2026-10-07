import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Card, Empty, ProductImage, QtyStepper } from '../../components/ui';
import { useAuth } from '../../context/auth';
import { lineKey, useCart } from '../../context/cart';
import { useStore } from '../../context/store';
import { confirmAsync } from '../../lib/dialog';
import { rupiah } from '../../lib/format';
import { colors, font, radius } from '../../lib/theme';

export default function Cart() {
  const cart = useCart();
  const { user } = useAuth();
  const { store } = useStore();

  if (!cart.items.length)
    return <Empty icon="cart-outline" title="Keranjang masih kosong" subtitle="Yuk pilih es segar dan makanan favorit Anda!" action={<Button title="Mulai Belanja" icon="grid" onPress={() => router.push('/products')} />} />;

  const freeMin = store?.free_delivery_min || 0;
  const remaining = freeMin - cart.subtotal;
  const belowMin = store && cart.subtotal < store.min_order;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 24 }}>
        {freeMin > 0 && (
          <View style={[s.info, remaining <= 0 && { backgroundColor: colors.okSoft }]}>
            <Text style={{ fontSize: 22 }}>{remaining > 0 ? '🛵' : '🎉'}</Text>
            <Text style={[s.infoText, remaining <= 0 && { color: '#166534' }]}>
              {remaining > 0 ? `Tambah ${rupiah(remaining)} lagi untuk GRATIS ONGKIR` : 'Selamat! Anda dapat gratis ongkir'}
            </Text>
          </View>
        )}
        {cart.items.map(({ product: p, variant: v, quantity }) => (
          <Card key={lineKey(p.id, v?.id)} style={s.item}>
            <Pressable onPress={() => router.push(`/product/${p.id}`)}>
              <ProductImage product={p} size={76} />
            </Pressable>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.name} numberOfLines={2}>
                {p.name}
              </Text>
              {v ? (
                <Text style={s.variant}>
                  {p.option_label ? `${p.option_label}: ` : ''}
                  {v.name}
                </Text>
              ) : null}
              <Text style={s.price}>
                {rupiah((v || p).price)} <Text style={s.unit}>/ {p.unit}</Text>
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={s.sub}>{rupiah((v || p).price * quantity)}</Text>
                <QtyStepper compact value={quantity} max={(v || p).stock} onChange={(n) => cart.setQty(p, v, n)} />
              </View>
            </View>
          </Card>
        ))}
        <Pressable
          style={s.clear}
          onPress={async () => {
            if (await confirmAsync('Kosongkan keranjang?', 'Semua barang akan dihapus dari keranjang.', 'Kosongkan')) cart.clear();
          }}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
          <Text style={{ color: colors.danger, fontWeight: '700', fontSize: font.sm }}>Kosongkan keranjang</Text>
        </Pressable>
      </ScrollView>

      <SafeAreaView edges={[]} style={s.footer}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 }}>
          <Text style={s.totalLabel}>Total belanja ({cart.count})</Text>
          <Text style={s.total}>{rupiah(cart.subtotal)}</Text>
        </View>
        {belowMin ? <Text style={s.warn}>Minimal belanja {rupiah(store.min_order)}</Text> : null}
        <Button
          title={user ? 'Lanjut ke Pembayaran' : 'Masuk untuk Memesan'}
          icon={user ? 'arrow-forward-circle' : 'log-in-outline'}
          variant="accent"
          disabled={belowMin}
          onPress={() => (user ? router.push('/checkout') : router.push({ pathname: '/login', params: { next: '/checkout' } }))}
        />
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  info: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.accentSoft, padding: 12, borderRadius: radius.md },
  infoText: { flex: 1, color: '#9A3412', fontWeight: '700', fontSize: font.sm },
  item: { flexDirection: 'row', gap: 12, padding: 12 },
  name: { fontSize: font.md, fontWeight: '700', color: colors.ink },
  price: { fontSize: font.sm, color: colors.muted },
  variant: { alignSelf: 'flex-start', fontSize: font.sm, fontWeight: '700', color: colors.brandDark, backgroundColor: colors.brandSoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  unit: { fontSize: font.xs },
  sub: { fontSize: font.md, fontWeight: '800', color: colors.brandDark },
  clear: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 12 },
  footer: { backgroundColor: colors.white, padding: 16, borderTopWidth: 1, borderTopColor: colors.line },
  totalLabel: { fontSize: font.md, color: colors.muted },
  total: { fontSize: font.xl, fontWeight: '900', color: colors.ink },
  warn: { color: colors.danger, fontWeight: '700', marginBottom: 8, textAlign: 'center' },
});
