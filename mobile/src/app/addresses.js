import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Empty, Loading } from '../components/ui';
import { api } from '../lib/api';
import { confirmAsync } from '../lib/dialog';
import { colors, font } from '../lib/theme';

export default function Addresses() {
  const [list, setList] = useState(null);

  const load = useCallback(() => {
    api('/me/addresses')
      .then((r) => setList(r.data))
      .catch(() => setList([]));
  }, []);
  useFocusEffect(load);

  if (!list) return <Loading />;
  if (!list.length)
    return <Empty icon="location-outline" title="Belum ada alamat" subtitle="Tambahkan alamat agar pesanan bisa diantar." action={<Button title="Tambah Alamat" icon="add" onPress={() => router.push('/address-form')} />} />;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {list.map((a) => (
        <Card key={a.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="location" size={20} color={colors.brand} />
            <Text style={s.label}>{a.label}</Text>
            {a.is_default ? <Text style={s.default}>Utama</Text> : null}
          </View>
          <Text style={s.name}>
            {a.recipient} · {a.phone}
          </Text>
          <Text style={s.addr}>{a.address}</Text>
          {a.notes ? <Text style={s.notes}>Patokan: {a.notes}</Text> : null}
          <Text style={[s.notes, { color: a.lat != null ? colors.ok : colors.warn }]}>{a.lat != null ? '📍 Titik peta sudah ditandai' : '⚠️ Belum ada titik peta — ketuk Ubah untuk menandai'}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Button size="sm" style={{ flex: 1 }} variant="soft" title="Ubah" icon="create-outline" onPress={() => router.push({ pathname: '/address-form', params: { id: a.id } })} />
            <Button
              size="sm"
              style={{ flex: 1 }}
              variant="danger"
              title="Hapus"
              icon="trash-outline"
              onPress={async () => {
                if (!(await confirmAsync('Hapus alamat?', a.address, 'Hapus'))) return;
                await api(`/me/addresses/${a.id}`, { method: 'DELETE' });
                load();
              }}
            />
          </View>
        </Card>
      ))}
      <Button title="Tambah Alamat Baru" icon="add" onPress={() => router.push('/address-form')} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  label: { fontSize: font.md, fontWeight: '800', color: colors.ink },
  default: { backgroundColor: colors.brandSoft, color: colors.brandDark, fontWeight: '700', fontSize: font.xs, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  name: { fontSize: font.md, fontWeight: '600', color: colors.ink, marginTop: 8 },
  addr: { fontSize: font.md, color: '#334155', marginTop: 2, lineHeight: 24 },
  notes: { fontSize: font.sm, color: colors.muted, marginTop: 4 },
});
