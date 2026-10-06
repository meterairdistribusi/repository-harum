import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Field, tap } from '../components/ui';
import { useAuth } from '../context/auth';
import { api } from '../lib/api';
import { notify } from '../lib/dialog';
import { colors, font, radius } from '../lib/theme';

const LABELS = ['Rumah', 'Kantor', 'Warung', 'Lainnya'];

export default function AddressForm() {
  const { id } = useLocalSearchParams();
  const { user } = useAuth();
  const [form, setForm] = useState({ label: 'Rumah', recipient: user?.name || '', phone: user?.phone || '', address: '', notes: '', is_default: false });
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!id) return;
    api('/me/addresses').then((r) => {
      const a = r.data.find((x) => String(x.id) === String(id));
      if (a) setForm({ ...a, is_default: !!a.is_default });
    });
  }, [id]);

  const save = async () => {
    if (!form.recipient || !form.phone || !form.address) return notify('Data belum lengkap', 'Nama penerima, nomor HP, dan alamat wajib diisi.');
    setSaving(true);
    try {
      await api(id ? `/me/addresses/${id}` : '/me/addresses', { method: id ? 'PUT' : 'POST', body: form });
      router.back();
    } catch (e) {
      notify('Gagal menyimpan', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={s.label}>Simpan sebagai</Text>
      <View style={s.labels}>
        {LABELS.map((l) => (
          <Pressable
            key={l}
            onPress={() => {
              tap();
              set('label')(l);
            }}
            style={[s.chip, form.label === l && s.chipActive]}
          >
            <Text style={[s.chipText, form.label === l && { color: colors.white }]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <Field label="Nama penerima" value={form.recipient} onChangeText={set('recipient')} />
      <Field label="Nomor HP penerima" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
      <Field label="Alamat lengkap" value={form.address} onChangeText={set('address')} placeholder="Jalan, nomor rumah, RT/RW, kelurahan, kecamatan" multiline />
      <Field label="Patokan (opsional)" value={form.notes} onChangeText={set('notes')} placeholder="Contoh: depan masjid, pagar hijau" />
      <Pressable style={s.check} onPress={() => set('is_default')(!form.is_default)}>
        <View style={[s.box, form.is_default && { backgroundColor: colors.brand, borderColor: colors.brand }]}>{form.is_default ? <Text style={{ color: colors.white, fontWeight: '900' }}>✓</Text> : null}</View>
        <Text style={{ fontSize: font.md, color: colors.ink }}>Jadikan alamat utama</Text>
      </Pressable>
      <Button title="Simpan Alamat" icon="save-outline" loading={saving} onPress={save} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  label: { fontSize: font.sm, fontWeight: '700', color: colors.ink, marginBottom: 8 },
  labels: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 16, height: 42, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.white, justifyContent: 'center' },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: font.sm, fontWeight: '700', color: colors.ink },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});
