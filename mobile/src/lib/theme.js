// Warna & ukuran dibuat besar dan kontras agar nyaman untuk semua umur.
export const colors = {
  brand: '#0284C7',
  brandDark: '#075985',
  brandSoft: '#E0F2FE',
  accent: '#F97316',
  accentSoft: '#FFEDD5',
  ok: '#16A34A',
  okSoft: '#DCFCE7',
  warn: '#D97706',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  ink: '#0F172A',
  muted: '#64748B',
  line: '#E2E8F0',
  bg: '#F5FAFF',
  card: '#FFFFFF',
  white: '#FFFFFF',
};

export const font = {
  xs: 13,
  sm: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 30,
};

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 };

export const shadow = {
  shadowColor: '#0F172A',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};

export const STATUS = {
  pending_payment: { label: 'Menunggu Pembayaran', color: '#92400E', bg: '#FEF3C7', icon: 'time-outline' },
  paid: { label: 'Pembayaran Diterima', color: '#1E40AF', bg: '#DBEAFE', icon: 'checkmark-circle-outline' },
  processing: { label: 'Sedang Disiapkan', color: '#3730A3', bg: '#E0E7FF', icon: 'restaurant-outline' },
  shipping: { label: 'Sedang Diantar', color: '#155E75', bg: '#CFFAFE', icon: 'bicycle-outline' },
  ready_pickup: { label: 'Siap Diambil', color: '#155E75', bg: '#CFFAFE', icon: 'storefront-outline' },
  completed: { label: 'Selesai', color: '#166534', bg: '#DCFCE7', icon: 'checkmark-done-circle-outline' },
  cancelled: { label: 'Dibatalkan', color: '#991B1B', bg: '#FEE2E2', icon: 'close-circle-outline' },
};
