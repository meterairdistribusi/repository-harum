import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, ErrorView, Loading, priceLabel, ProductImage, QtyStepper, tap } from '../../components/ui';
import { useCart } from '../../context/cart';
import { useVersion } from '../../context/realtime';
import { api } from '../../lib/api';
import { rupiah } from '../../lib/format';
import { colors, font, radius } from '../../lib/theme';

/** Galeri foto yang bisa digeser, dengan titik penanda. */
function Gallery({ product }) {
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const photos = product.images?.length ? product.images : [null];
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          onScroll={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
          scrollEventThrottle={64}
        >
          {photos.map((uri, i) => (
            <View key={i} style={{ width }}>
              <ProductImage product={product} uri={uri} style={{ borderRadius: radius.lg }} />
            </View>
          ))}
        </ScrollView>
      )}
      {photos.length > 1 && (
        <View style={s.dots}>
          {photos.map((_, i) => (
            <View key={i} style={[s.dot, i === index && s.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

export default function ProductDetail() {
  const { id } = useLocalSearchParams();
  const cart = useCart();
  const productsV = useVersion('products');
  const [p, setP] = useState(null);
  const [error, setError] = useState(null);
  const [variantId, setVariantId] = useState(null);
  const [qty, setQty] = useState(null); // null = ikuti jumlah di keranjang

  // Muat ulang otomatis bila admin mengubah sub menu ini (harga, foto, pilihan, stok)
  useEffect(() => {
    api(`/products/${id}`)
      .then((r) => {
        setP(r.data);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [id, productsV]);

  if (error && !p) return <ErrorView message={error} onRetry={() => router.back()} />;
  if (!p) return <Loading />;

  const variants = p.variants || [];
  // Pilihan default: yang pertama masih ada stoknya
  const variant = p.has_variants ? variants.find((v) => v.id === variantId) || variants.find((v) => v.stock > 0) || variants[0] : null;
  const src = variant || p;
  const inCart = cart.qtyOf(p.id, variant?.id);
  const soldOut = src.stock <= 0;
  const shownQty = Math.max(1, Math.min(qty ?? (inCart || 1), src.stock || 1));

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: p.category_name }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Gallery product={p} />
        <Text style={s.name}>{p.name}</Text>
        <Text style={s.price}>
          {variant ? rupiah(variant.price) : priceLabel(p)} <Text style={s.unit}>/ {p.unit}</Text>
        </Text>

        {p.has_variants && (
          <>
            <Text style={s.h}>Pilih {p.option_label || 'pilihan'}</Text>
            <View style={s.options}>
              {variants.map((v) => {
                const active = v.id === variant?.id;
                const empty = v.stock <= 0;
                return (
                  <Pressable
                    key={v.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active, disabled: empty }}
                    onPress={() => {
                      tap();
                      setVariantId(v.id);
                      setQty(null);
                    }}
                    style={[s.option, active && s.optionActive, empty && { opacity: 0.45 }]}
                  >
                    <Text style={[s.optionName, active && { color: colors.white }]}>{v.name}</Text>
                    <Text style={[s.optionPrice, active && { color: 'rgba(255,255,255,.9)' }]}>{empty ? 'Habis' : rupiah(v.price)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        <View style={[s.stock, soldOut && { backgroundColor: colors.dangerSoft }]}>
          <Text style={[s.stockText, soldOut && { color: colors.danger }]}>
            {soldOut ? 'Stok habis' : src.stock <= 10 ? `Sisa ${src.stock} ${p.unit} — segera pesan!` : 'Stok tersedia'}
          </Text>
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
            <Text style={s.qtyLabel}>Jumlah{variant ? ` · ${variant.name}` : ''}</Text>
            <QtyStepper value={shownQty} max={src.stock} onChange={(n) => setQty(Math.max(1, n))} />
          </View>
          <Button
            icon="cart"
            title={`${inCart ? 'Perbarui' : 'Masukkan'} Keranjang · ${rupiah(src.price * shownQty)}`}
            onPress={() => {
              cart.setQty(p, variant, shownQty);
              router.back();
            }}
          />
        </SafeAreaView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  dotActive: { width: 22, backgroundColor: colors.brand },
  name: { fontSize: font.xl, fontWeight: '900', color: colors.ink, marginTop: 16 },
  price: { fontSize: font.xl, fontWeight: '800', color: colors.brandDark, marginTop: 6 },
  unit: { fontSize: font.md, color: colors.muted, fontWeight: '500' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  option: { minWidth: '30%', flexGrow: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.white, alignItems: 'center' },
  optionActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  optionName: { fontSize: font.md, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  optionPrice: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  stock: { alignSelf: 'flex-start', backgroundColor: colors.okSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 6, marginTop: 14 },
  stockText: { color: '#166534', fontWeight: '700', fontSize: font.sm },
  h: { fontSize: font.md, fontWeight: '800', marginTop: 20, marginBottom: 10, color: colors.ink },
  desc: { fontSize: font.md, color: '#334155', lineHeight: 26 },
  footer: { backgroundColor: colors.white, padding: 16, borderTopWidth: 1, borderTopColor: colors.line },
  qtyLabel: { fontSize: font.md, fontWeight: '700', color: colors.ink, flexShrink: 1 },
});
