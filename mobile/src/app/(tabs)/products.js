import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import CartBar from '../../components/CartBar';
import { Empty, ErrorView, Loading, ProductCard, tap } from '../../components/ui';
import { useCart } from '../../context/cart';
import { useStore } from '../../context/store';
import { api } from '../../lib/api';
import { colors, font, radius } from '../../lib/theme';

export default function Products() {
  const params = useLocalSearchParams();
  const { categories } = useStore();
  const cart = useCart();
  const [category, setCategory] = useState(params.category || '');
  const [q, setQ] = useState('');
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const inputRef = useRef(null);

  // Sinkronkan bila dibuka dari kategori di beranda
  const [lastParam, setLastParam] = useState(params.category);
  if (params.category !== lastParam) {
    setLastParam(params.category);
    if (params.category !== undefined) setCategory(params.category);
  }

  useEffect(() => {
    if (params.focus) setTimeout(() => inputRef.current?.focus(), 300);
  }, [params.focus]);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (category) qs.set('category', category);
      if (q.trim()) qs.set('q', q.trim());
      const r = await api('/products?' + qs.toString());
      setItems(r.data);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [category, q]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0); // debounce pencarian
    return () => clearTimeout(t);
  }, [load, q]);

  const chips = [{ slug: '', name: 'Semua', icon: '✨' }, ...categories];
  const current = categories.find((c) => c.slug === category);

  return (
    <View style={{ flex: 1 }}>
      <View style={s.searchWrap}>
        <Ionicons name="search" size={22} color={colors.muted} />
        <TextInput ref={inputRef} value={q} onChangeText={setQ} placeholder="Cari produk…" placeholderTextColor="#94A3B8" style={s.search} returnKeyType="search" />
        {q ? (
          <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel="Hapus pencarian">
            <Ionicons name="close-circle" size={22} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {chips.map((c) => {
            const active = c.slug === category;
            return (
              <Pressable
                key={c.slug || 'all'}
                onPress={() => {
                  tap();
                  setCategory(c.slug);
                }}
                style={[s.chip, active && s.chipActive]}
              >
                <Text style={{ fontSize: 18 }}>{c.icon}</Text>
                <Text style={[s.chipText, active && { color: colors.white }]}>{c.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {current?.description ? <Text style={s.desc}>{current.description}</Text> : null}

      {error && !items ? (
        <ErrorView message={error} onRetry={load} />
      ) : !items ? (
        <Loading />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => String(p.id)}
          numColumns={2}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
          ListEmptyComponent={<Empty icon="search" title="Produk tidak ditemukan" subtitle="Coba kata kunci atau kategori lain." />}
          renderItem={({ item: p }) => (
            <View style={{ flex: 1, maxWidth: '50%' }}>
              <ProductCard product={p} qty={cart.qtyOf(p.id)} onPress={() => router.push(`/product/${p.id}`)} onAdd={() => cart.add(p)} onQty={(n) => cart.setQty(p, n)} />
            </View>
          )}
        />
      )}
      <CartBar />
    </View>
  );
}

const s = StyleSheet.create({
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 8, height: 54, borderRadius: radius.md, backgroundColor: colors.white, paddingHorizontal: 14, borderWidth: 1.5, borderColor: colors.line },
  search: { flex: 1, fontSize: font.md, color: colors.ink, height: '100%' },
  chips: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 44, borderRadius: radius.pill, backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.line },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: font.sm, fontWeight: '700', color: colors.ink },
  desc: { marginHorizontal: 16, fontSize: font.sm, color: colors.muted },
});
