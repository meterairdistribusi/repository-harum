import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Field } from '../components/ui';
import { useAuth } from '../context/auth';
import { colors, font } from '../lib/theme';

export default function Login() {
  const { next } = useLocalSearchParams();
  const { login } = useAuth();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError('');
    if (!id || !password) return setError('Isi nomor HP dan kata sandi');
    setLoading(true);
    try {
      await login(id.trim(), password);
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
          <Text style={{ fontSize: 56 }}>🧊</Text>
        </View>
        <Text style={s.title}>Masuk ke Harum Group</Text>
        <Text style={s.sub}>Gunakan nomor HP yang sudah terdaftar.</Text>
        <Field label="Nomor HP" value={id} onChangeText={setId} placeholder="08xxxxxxxxxx" keyboardType="phone-pad" autoComplete="tel" autoCapitalize="none" />
        <Field label="Kata sandi" value={password} onChangeText={setPassword} placeholder="Minimal 6 karakter" secureTextEntry autoComplete="password" onSubmitEditing={submit} />
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Button title="Masuk" icon="log-in-outline" loading={loading} onPress={submit} />
        <Pressable style={s.link} onPress={() => router.replace({ pathname: '/register', params: next ? { next } : {} })}>
          <Text style={s.linkText}>
            Belum punya akun? <Text style={{ color: colors.brand, fontWeight: '800' }}>Daftar di sini</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  logo: { width: 100, height: 100, borderRadius: 50, backgroundColor: colors.brandSoft, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: font.xl, fontWeight: '900', color: colors.ink, textAlign: 'center' },
  sub: { fontSize: font.md, color: colors.muted, textAlign: 'center', marginTop: 6, marginBottom: 24 },
  error: { color: colors.danger, fontWeight: '700', marginBottom: 12, textAlign: 'center', fontSize: font.md },
  link: { padding: 16, alignItems: 'center' },
  linkText: { fontSize: font.md, color: colors.muted },
});
