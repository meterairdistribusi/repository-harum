import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Empty, ErrorView, Loading, StatusBadge } from '../../components/ui';
import { useAuth } from '../../context/auth';
import { api } from '../../lib/api';
import { dateTime, rupiah } from '../../lib/format';
import { colors, font } from '../../lib/theme';

export default function Orders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setOrders((await api('/me/orders')).data);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  if (!user)
    return <Empty icon="receipt-outline" title="Belum masuk" subtitle="Masuk untuk melihat riwayat pesanan Anda." action={<Button title="Masuk / Daftar" icon="log-in-outline" onPress={() => router.push('/login')} />} />;
  if (error && !orders) return <ErrorView message={error} onRetry={load} />;
  if (!orders) return <Loading />;

  return (
    <FlatList
      data={orders}
      keyExtractor={(o) => o.code}
      contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1 }}
      refreshing={refreshing}
      onRefresh={async () => {
        setRefreshing(true);
        await load();
        setRefreshing(false);
      }}
      ListEmptyComponent={<Empty icon="receipt-outline" title="Belum ada pesanan" subtitle="Pesanan Anda akan muncul di sini." action={<Button title="Mulai Belanja" icon="grid" onPress={() => router.push('/products')} />} />}
      renderItem={({ item: o }) => (
        <Card onPress={() => router.push(o.status === 'pending_payment' ? `/payment/${o.code}` : `/order/${o.code}`)}>
          <View style={s.top}>
            <StatusBadge status={o.status} />
            <Text style={s.date}>{dateTime(o.created_at)}</Text>
          </View>
          <Text style={s.title} numberOfLines={1}>
            {o.first_item}
            {o.item_count > 1 ? ` +${o.item_count - 1} lainnya` : ''}
          </Text>
          <View style={s.bottom}>
            <Text style={s.code}>{o.code}</Text>
            <Text style={s.total}>{rupiah(o.total)}</Text>
          </View>
          {o.status === 'pending_payment' && (
            <View style={s.payNow}>
              <Ionicons name="wallet" size={18} color={colors.white} />
              <Text style={s.payNowText}>Bayar Sekarang</Text>
            </View>
          )}
        </Card>
      )}
    />
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: font.xs, color: colors.muted },
  title: { fontSize: font.md, fontWeight: '700', color: colors.ink, marginTop: 10 },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  code: { fontSize: font.sm, color: colors.muted },
  total: { fontSize: font.lg, fontWeight: '900', color: colors.brandDark },
  payNow: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: 10, padding: 10, marginTop: 12 },
  payNowText: { color: colors.white, fontWeight: '800', fontSize: font.md },
});
