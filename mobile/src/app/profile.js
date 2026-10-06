import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Button, Card, Field } from '../components/ui';
import { useAuth } from '../context/auth';
import { notify } from '../lib/dialog';
import { colors, font } from '../lib/theme';

export default function Profile() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateProfile({ name, email, ...(next ? { current_password: current, new_password: next } : {}) });
      notify('Tersimpan', 'Profil berhasil diperbarui.');
      router.back();
    } catch (e) {
      notify('Gagal menyimpan', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Card>
        <Field label="Nama" value={name} onChangeText={setName} />
        <Field label="Nomor HP" value={user?.phone || ''} editable={false} />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      </Card>
      <Card>
        <Text style={{ fontSize: font.md, fontWeight: '800', color: colors.ink, marginBottom: 12 }}>Ganti kata sandi (opsional)</Text>
        <Field label="Kata sandi lama" value={current} onChangeText={setCurrent} secureTextEntry />
        <Field label="Kata sandi baru" value={next} onChangeText={setNext} secureTextEntry />
      </Card>
      <Button title="Simpan" icon="save-outline" loading={saving} onPress={save} />
    </ScrollView>
  );
}
