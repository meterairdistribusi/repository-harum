import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapPicker from '../components/MapPicker';
import { Button, Field, tap } from '../components/ui';
import { useAuth } from '../context/auth';
import { useStore } from '../context/store';
import { api } from '../lib/api';
import { notify } from '../lib/dialog';
import { colors, font, radius } from '../lib/theme';

const LABELS = ['Rumah', 'Kantor', 'Warung', 'Lainnya'];

export default function AddressForm() {
  const { id } = useLocalSearchParams();
  const { user } = useAuth();
  const { store } = useStore();
  const [form, setForm] = useState({ label: 'Rumah', recipient: user?.name || '', phone: user?.phone || '', address: '', notes: '', is_default: false, lat: null, lng: null });
  const [loaded, setLoaded] = useState(!id);
  const [mapKey, setMapKey] = useState(0);
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const needPin = store?.shipping_mode === 'distance';
  const storePoint = store?.store_location_set ? { lat: store.store_lat, lng: store.store_lng } : null;

  useEffect(() => {
    if (!id) return;
    api('/me/addresses').then((r) => {
      const a = r.data.find((x) => String(x.id) === String(id));
      if (a) setForm({ ...a, is_default: !!a.is_default });
      setLoaded(true);
    });
  }, [id]);

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return notify('Izin lokasi ditolak', 'Anda tetap bisa menandai titik dengan menggeser peta.');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setForm((f) => ({ ...f, lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) }));
      setMapKey((k) => k + 1); // pusatkan peta ke lokasi baru
    } catch {
      notify('Lokasi tidak ditemukan', 'Pastikan GPS aktif, atau tandai titik di peta.');
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    if (!form.recipient || !form.phone || !form.address) return notify('Data belum lengkap', 'Nama penerima, nomor HP, dan alamat wajib diisi.');
    if (needPin && form.lat == null) return notify('Titik lokasi belum ditandai', 'Tandai lokasi alamat di peta agar ongkir bisa dihitung.');
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

      <Text style={s.label}>Titik lokasi di peta {needPin ? <Text style={{ color: colors.danger }}>*</Text> : '(disarankan)'}</Text>
      <Text style={s.help}>Geser atau ketuk peta untuk menandai rumah Anda. Ongkir dihitung dari jarak tempuh toko ke titik ini.</Text>
      <Button size="sm" variant="soft" icon="locate" title="Gunakan Lokasi Saya Sekarang" loading={locating} onPress={useMyLocation} style={{ marginBottom: 10 }} />
      {loaded && (
        <MapPicker
          lat={form.lat}
          lng={form.lng}
          center={storePoint}
          store={storePoint}
          reloadKey={mapKey}
          onPick={({ lat, lng }) => setForm((f) => ({ ...f, lat, lng }))}
          onAddress={(text) => setForm((f) => (f.address ? f : { ...f, address: text }))}
        />
      )}
      <View style={[s.pinStatus, form.lat != null && { backgroundColor: colors.okSoft }]}>
        <Ionicons name={form.lat != null ? 'checkmark-circle' : 'location-outline'} size={20} color={form.lat != null ? colors.ok : colors.muted} />
        <Text style={[s.pinText, form.lat != null && { color: '#166534' }]}>{form.lat != null ? 'Titik lokasi sudah ditandai' : 'Belum ada titik lokasi'}</Text>
      </View>

      <Field label="Alamat lengkap" value={form.address} onChangeText={set('address')} placeholder="Jalan, nomor rumah, RT/RW, kelurahan, kecamatan" multiline />
      <Field label="Patokan (opsional)" value={form.notes} onChangeText={set('notes')} placeholder="Contoh: depan masjid, pagar hijau" />
      <Field label="Nama penerima" value={form.recipient} onChangeText={set('recipient')} />
      <Field label="Nomor HP penerima" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
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
  help: { fontSize: font.sm, color: colors.muted, marginBottom: 10, marginTop: -4, lineHeight: 20 },
  labels: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 16, height: 42, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.white, justifyContent: 'center' },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: font.sm, fontWeight: '700', color: colors.ink },
  pinStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.sm, backgroundColor: colors.line, marginTop: 10, marginBottom: 16 },
  pinText: { fontSize: font.sm, fontWeight: '700', color: colors.muted },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  box: { width: 26, height: 26, borderRadius: 6, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
});
