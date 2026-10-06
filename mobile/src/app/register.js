import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Field } from '../components/ui';
import { useAuth } from '../context/auth';
import { colors, font } from '../lib/theme';

export default function Register() {
  const { next } = useLocalSearchParams();
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError('');
    if (!form.name || !form.phone || !form.password) return setError('Nama, nomor HP, dan kata sandi wajib diisi');
    if (form.password.length < 6) return setError('Kata sandi minimal 6 karakter');
    setLoading(true);
    try {
      await register({ ...form, email: form.email || undefined });
      router.back();
      if (next) router.push(next);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
        <View style={s.logo}>
          <Text style={{ fontSize: 48 }}>👋</Text>
        </View>
        <Text style={s.title}>Daftar Akun Baru</Text>
        <Text style={s.sub}>Cukup isi nama dan nomor HP, gratis!</Text>
        <Field label="Nama lengkap" value={form.name} onChangeText={set('name')} placeholder="Contoh: Siti Aminah" autoComplete="name" />
        <Field label="Nomor HP / WhatsApp" value={form.phone} onChangeText={set('phone')} placeholder="08xxxxxxxxxx" keyboardType="phone-pad" autoComplete="tel" />
        <Field label="Email (boleh dikosongkan)" value={form.email} onChangeText={set('email')} placeholder="nama@email.com" keyboardType="email-address" autoCapitalize="none" />
        <Field label="Buat kata sandi" value={form.password} onChangeText={set('password')} placeholder="Minimal 6 karakter" secureTextEntry />
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Button title="Daftar Sekarang" icon="person-add-outline" loading={loading} onPress={submit} />
        <Pressable style={s.link} onPress={() => router.replace({ pathname: '/login', params: next ? { next } : {} })}>
          <Text style={s.linkText}>
            Sudah punya akun? <Text style={{ color: colors.brand, fontWeight: '800' }}>Masuk</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  logo: { width: 90, height: 90, borderRadius: 45, backgroundColor: colors.brandSoft, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: font.xl, fontWeight: '900', color: colors.ink, textAlign: 'center' },
  sub: { fontSize: font.md, color: colors.muted, textAlign: 'center', marginTop: 6, marginBottom: 24 },
  error: { color: colors.danger, fontWeight: '700', marginBottom: 12, textAlign: 'center', fontSize: font.md },
  link: { padding: 16, alignItems: 'center' },
  linkText: { fontSize: font.md, color: colors.muted },
});
