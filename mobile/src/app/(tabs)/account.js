import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, tap } from '../../components/ui';
import { useAuth } from '../../context/auth';
import { useStore } from '../../context/store';
import { confirmAsync } from '../../lib/dialog';
import { colors, font, radius } from '../../lib/theme';

function Item({ icon, title, subtitle, onPress, color = colors.brand }) {
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      style={({ pressed }) => [s.item, pressed && { backgroundColor: '#F8FAFC' }]}
    >
      <View style={[s.itemIcon, { backgroundColor: color + '1A' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.itemTitle}>{title}</Text>
        {subtitle ? <Text style={s.itemSub}>{subtitle}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color="#CBD5E1" />
    </Pressable>
  );
}

export default function Account() {
  const { user, logout } = useAuth();
  const { store } = useStore();
  const wa = store?.store_phone?.replace(/^0/, '62');

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      {user ? (
        <Card style={s.profile}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{user.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{user.name}</Text>
            <Text style={s.phone}>{user.phone || user.email}</Text>
          </View>
        </Card>
      ) : (
        <Card style={{ gap: 12 }}>
          <Text style={s.name}>Selamat datang di Harum Market 👋</Text>
          <Text style={s.phone}>Masuk atau daftar untuk mulai memesan.</Text>
          <Button title="Masuk" icon="log-in-outline" onPress={() => router.push('/login')} />
          <Button title="Daftar Akun Baru" variant="soft" onPress={() => router.push('/register')} />
        </Card>
      )}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {user && (
          <>
            <Item icon="receipt-outline" title="Pesanan Saya" onPress={() => router.push('/orders')} />
            <Item icon="location-outline" title="Alamat Saya" subtitle="Atur alamat pengiriman" onPress={() => router.push('/addresses')} />
            <Item icon="person-outline" title="Ubah Profil & Kata Sandi" onPress={() => router.push('/profile')} />
          </>
        )}
        {wa ? <Item icon="logo-whatsapp" color="#16A34A" title="Hubungi Kami (WhatsApp)" subtitle={store.store_phone} onPress={() => Linking.openURL(`https://wa.me/${wa}`)} /> : null}
        <Item icon="storefront-outline" title="Info Toko" subtitle={store ? `${store.store_address} · ${store.opening_hours}` : ''} onPress={() => {}} />
      </Card>

      <Card style={{ backgroundColor: colors.brandSoft }}>
        <Text style={s.howTitle}>Cara Belanja</Text>
        {['Pilih produk lalu tekan "Tambah"', 'Buka Keranjang, tekan "Lanjut ke Pembayaran"', 'Pilih diantar / ambil sendiri & cara bayar', 'Bayar dengan QRIS, Transfer Bank, E-Wallet, atau Tunai', 'Pantau status pesanan di menu Pesanan'].map((t, i) => (
          <Text key={i} style={s.how}>
            {i + 1}. {t}
          </Text>
        ))}
      </Card>

      {user && (
        <Button
          variant="danger"
          icon="log-out-outline"
          title="Keluar"
          onPress={async () => {
            if (await confirmAsync('Keluar dari akun?', 'Anda perlu masuk lagi untuk memesan.', 'Keluar')) logout();
          }}
        />
      )}
      <Text style={s.version}>Harum Market v1.1.0 · oleh Harum Group</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.white, fontSize: font.xl, fontWeight: '900' },
  name: { fontSize: font.lg, fontWeight: '800', color: colors.ink },
  phone: { fontSize: font.md, color: colors.muted, marginTop: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  itemIcon: { width: 42, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: font.md, fontWeight: '700', color: colors.ink },
  itemSub: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
  howTitle: { fontSize: font.md, fontWeight: '800', color: colors.brandDark, marginBottom: 6 },
  how: { fontSize: font.md, color: colors.brandDark, lineHeight: 28 },
  version: { textAlign: 'center', color: '#94A3B8', fontSize: font.xs, marginBottom: 24 },
});
