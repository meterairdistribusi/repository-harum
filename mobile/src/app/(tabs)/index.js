import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Dimensions, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import CartBar from '../../components/CartBar';
import { ErrorView, ProductCard, SectionTitle } from '../../components/ui';
import { useAuth } from '../../context/auth';
import { useCart } from '../../context/cart';
import { useStore } from '../../context/store';
import { api } from '../../lib/api';
import { rupiah } from '../../lib/format';
import { colors, font, radius, shadow } from '../../lib/theme';

const W = Math.min(Dimensions.get('window').width, 520);

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'Selamat pagi';
  if (h < 15) return 'Selamat siang';
  if (h < 18) return 'Selamat sore';
  return 'Selamat malam';
}

export default function Home() {
  const { user } = useAuth();
  const { store, categories, error, reload } = useStore();
  const cart = useCart();
  const [banners, setBanners] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [b, f] = await Promise.all([api('/banners'), api('/products?featured=1')]);
      setBanners(b.data);
      setFeatured(f.data);
      setLoadError(null);
    } catch (e) {
      setLoadError(e.message);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([load(), reload()]);
    setRefreshing(false);
  };

  if ((error || loadError) && !featured.length)
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <ErrorView message={error || loadError} onRetry={onRefresh} />
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {/* Header */}
        <View style={s.header}>
          <View style={{ flex: 1 }}>
            <Text style={s.hello}>
              {greeting()}
              {user ? `, ${user.name.split(' ')[0]}` : ''} 👋
            </Text>
            <Text style={s.brand}>{store?.store_name || 'Harum Market'}</Text>
            <Text style={s.tagline}>{store?.store_tagline}</Text>
          </View>
          <Pressable style={s.cartBtn} onPress={() => router.push('/cart')} accessibilityLabel="Buka keranjang">
            <Ionicons name="cart" size={26} color={colors.brand} />
            {cart.count > 0 && (
              <View style={s.dot}>
                <Text style={s.dotText}>{cart.count}</Text>
              </View>
            )}
          </Pressable>
        </View>

        {/* Pencarian */}
        <Pressable style={s.search} onPress={() => router.push({ pathname: '/products', params: { focus: '1' } })}>
          <Ionicons name="search" size={22} color={colors.muted} />
          <Text style={s.searchText}>Cari es kristal, nugget, nasi…</Text>
        </Pressable>

        {/* Status toko */}
        {store && (
          <View style={[s.status, { backgroundColor: store.is_open ? colors.okSoft : colors.dangerSoft }]}>
            <Ionicons name={store.is_open ? 'storefront' : 'moon'} size={20} color={store.is_open ? colors.ok : colors.danger} />
            <Text style={[s.statusText, { color: store.is_open ? '#166534' : '#991B1B' }]}>
              {store.is_open ? `Toko buka · ${store.opening_hours}` : 'Toko sedang tutup'}
            </Text>
          </View>
        )}

        {/* Banner */}
        {banners.length > 0 && (
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} snapToInterval={W - 24} decelerationRate="fast" contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
            {banners.map((b) => (
              <View key={b.id} style={[s.banner, { backgroundColor: b.color, width: W - 32 }]}>
                <Text style={s.bannerTitle}>{b.title}</Text>
                <Text style={s.bannerSub}>{b.subtitle}</Text>
                <Text style={s.bannerDeco}>🧊</Text>
              </View>
            ))}
          </ScrollView>
        )}

        <View style={{ paddingHorizontal: 16 }}>
          {/* Kategori */}
          <SectionTitle title="Mau beli apa hari ini?" />
          <View style={s.catGrid}>
            {categories.map((c) => (
              <Pressable key={c.id} style={({ pressed }) => [s.cat, pressed && { opacity: 0.8 }]} onPress={() => router.push({ pathname: '/products', params: { category: c.slug } })}>
                <View style={[s.catIcon, { backgroundColor: c.color }]}>
                  <Text style={{ fontSize: 34 }}>{c.icon}</Text>
                </View>
                <Text style={s.catName} numberOfLines={2}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </View>

          {store?.free_delivery_min > 0 && (
            <View style={s.promo}>
              <Text style={{ fontSize: 28 }}>🛵</Text>
              <Text style={s.promoText}>
                Gratis ongkir untuk belanja minimal <Text style={{ fontWeight: '800' }}>{rupiah(store.free_delivery_min)}</Text>
              </Text>
            </View>
          )}

          {/* Unggulan */}
          <SectionTitle title="⭐ Paling Laris" action="Lihat semua" onAction={() => router.push('/products')} />
          <View style={s.grid}>
            {featured.map((p) => (
              <View key={p.id} style={s.gridItem}>
                <ProductCard
                  product={p}
                  qty={cart.qtyOf(p.id)}
                  onPress={() => router.push(`/product/${p.id}`)}
                  onAdd={() => cart.add(p)}
                  onQty={(q) => cart.setQty(p, q)}
                />
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
      <CartBar />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 },
  hello: { fontSize: font.md, color: colors.muted },
  brand: { fontSize: font.xxl, fontWeight: '900', color: colors.brandDark, marginTop: 2 },
  tagline: { fontSize: font.sm, color: colors.muted },
  cartBtn: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', ...shadow },
  dot: { position: 'absolute', top: 4, right: 2, backgroundColor: colors.accent, borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  dotText: { color: colors.white, fontSize: 12, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginBottom: 10, height: 56, borderRadius: radius.md, backgroundColor: colors.white, paddingHorizontal: 16, borderWidth: 1.5, borderColor: colors.line },
  searchText: { fontSize: font.md, color: '#94A3B8' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 14, padding: 10, borderRadius: radius.sm },
  statusText: { fontSize: font.sm, fontWeight: '700' },
  banner: { height: 140, borderRadius: radius.lg, padding: 20, justifyContent: 'center', overflow: 'hidden' },
  bannerTitle: { color: colors.white, fontSize: font.xl, fontWeight: '900', maxWidth: '75%' },
  bannerSub: { color: 'rgba(255,255,255,.92)', fontSize: font.md, marginTop: 6, maxWidth: '75%' },
  bannerDeco: { position: 'absolute', right: -10, bottom: -18, fontSize: 110, opacity: 0.25 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: '3.5%', rowGap: 14 },
  cat: { width: '31%', alignItems: 'center' },
  catIcon: { width: '100%', aspectRatio: 1.15, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  catName: { fontSize: font.sm, fontWeight: '700', color: colors.ink, textAlign: 'center', marginTop: 6 },
  promo: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.accentSoft, borderRadius: radius.md, padding: 14, marginTop: 20 },
  promoText: { flex: 1, fontSize: font.md, color: '#9A3412' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  gridItem: { width: '48.5%' },
});
