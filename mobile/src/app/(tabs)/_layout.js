import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/tabs';
import { useCart } from '../../context/cart';
import { colors } from '../../lib/theme';

function icon(name) {
  return function TabIcon({ color, focused }) {
    return <Ionicons name={focused ? name : `${name}-outline`} size={22} color={color} />;
  };
}

export default function TabsLayout() {
  const { count } = useCart();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: '#94A3B8',
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { height: 60, paddingTop: 4, paddingBottom: 6, borderTopColor: colors.line },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { fontWeight: '700', fontSize: 18, color: colors.ink },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Beranda', headerShown: false, tabBarIcon: icon('home') }} />
      <Tabs.Screen name="products" options={{ title: 'Belanja', tabBarIcon: icon('grid') }} />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Keranjang',
          tabBarIcon: icon('cart'),
          tabBarBadge: count > 0 ? count : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, fontWeight: '800' },
        }}
      />
      <Tabs.Screen name="orders" options={{ title: 'Pesanan', tabBarIcon: icon('receipt') }} />
      <Tabs.Screen name="account" options={{ title: 'Akun', tabBarIcon: icon('person') }} />
    </Tabs>
  );
}
