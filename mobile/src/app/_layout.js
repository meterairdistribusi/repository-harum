import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../context/auth';
import { CartProvider } from '../context/cart';
import { StoreProvider } from '../context/store';
import { colors, font } from '../lib/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StoreProvider>
          <CartProvider>
            <StatusBar style="dark" />
            <Stack
              screenOptions={{
                headerTintColor: colors.brandDark,
                headerTitleStyle: { fontWeight: '800', fontSize: font.lg, color: colors.ink },
                headerShadowVisible: false,
                headerStyle: { backgroundColor: colors.bg },
                contentStyle: { backgroundColor: colors.bg },
                headerBackTitle: 'Kembali',
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="product/[id]" options={{ title: '' }} />
              <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
              <Stack.Screen name="payment/[code]" options={{ title: 'Pembayaran', gestureEnabled: false }} />
              <Stack.Screen name="order/[code]" options={{ title: 'Detail Pesanan' }} />
              <Stack.Screen name="login" options={{ title: 'Masuk', presentation: 'modal' }} />
              <Stack.Screen name="register" options={{ title: 'Daftar Akun', presentation: 'modal' }} />
              <Stack.Screen name="addresses" options={{ title: 'Alamat Saya' }} />
              <Stack.Screen name="address-form" options={{ title: 'Alamat', presentation: 'modal' }} />
              <Stack.Screen name="profile" options={{ title: 'Ubah Profil' }} />
            </Stack>
          </CartProvider>
        </StoreProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
