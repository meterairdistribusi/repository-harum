import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useCart } from '../context/cart';
import { rupiah } from '../lib/format';
import { colors, font, radius } from '../lib/theme';
import { tap } from './ui';

/** Bar keranjang mengambang di bawah layar katalog. */
export default function CartBar() {
  const { count, subtotal } = useCart();
  if (!count) return null;
  return (
    <View style={s.wrap} pointerEvents="box-none">
      <Pressable
        style={({ pressed }) => [s.bar, pressed && { opacity: 0.9 }]}
        onPress={() => {
          tap();
          router.push('/cart');
        }}
        accessibilityLabel={`Lihat keranjang, ${count} barang`}
      >
        <View style={s.icon}>
          <Ionicons name="cart" size={18} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.count} numberOfLines={1}>
            {count} barang
          </Text>
          <Text style={s.total} numberOfLines={1} adjustsFontSizeToFit>
            {rupiah(subtotal)}
          </Text>
        </View>
        <Text style={s.cta}>Lihat Keranjang</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.white} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 12, paddingHorizontal: 16 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.brand, borderRadius: radius.lg, padding: 8, paddingRight: 14, elevation: 6, shadowColor: '#0284C7', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  icon: { width: 36, height: 36, borderRadius: 10, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  count: { color: 'rgba(255,255,255,.85)', fontSize: font.xs },
  total: { color: colors.white, fontSize: font.md, fontWeight: '800' },
  cta: { color: colors.white, fontSize: font.sm, fontWeight: '800', flexShrink: 0 },
});
