import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, radius, shadow, STATUS } from '../lib/theme';
import { rupiah } from '../lib/format';

export const tap = () => {
  if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
};

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style, size = 'lg' }) {
  const v = VARIANTS[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled || loading}
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.btn,
        size === 'sm' && styles.btnSm,
        { backgroundColor: v.bg, borderColor: v.border || v.bg },
        (disabled || loading) && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={size === 'sm' ? 18 : 22} color={v.fg} /> : null}
          <Text style={[styles.btnText, size === 'sm' && { fontSize: font.sm }, { color: v.fg }]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

const VARIANTS = {
  primary: { bg: colors.brand, fg: colors.white },
  accent: { bg: colors.accent, fg: colors.white },
  ok: { bg: colors.ok, fg: colors.white },
  soft: { bg: colors.brandSoft, fg: colors.brandDark },
  outline: { bg: colors.white, fg: colors.brandDark, border: colors.line },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
};

export function Card({ children, style, onPress }) {
  if (onPress)
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && { opacity: 0.85 }]}>
        {children}
      </Pressable>
    );
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field({ label, error, style, ...props }) {
  return (
    <View style={[{ marginBottom: 14 }, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor="#94A3B8" style={[styles.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }]} {...props} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export function QtyStepper({ value, onChange, max = 999, compact }) {
  const size = compact ? 34 : 44;
  return (
    <View style={styles.stepper}>
      <Pressable
        accessibilityLabel="Kurangi"
        onPress={() => {
          tap();
          onChange(value - 1);
        }}
        style={[styles.stepBtn, { width: size, height: size }]}
      >
        <Ionicons name={value <= 1 ? 'trash-outline' : 'remove'} size={compact ? 18 : 22} color={colors.brandDark} />
      </Pressable>
      <Text style={[styles.stepVal, compact && { minWidth: 30, fontSize: font.md }]}>{value}</Text>
      <Pressable
        accessibilityLabel="Tambah"
        disabled={value >= max}
        onPress={() => {
          tap();
          onChange(value + 1);
        }}
        style={[styles.stepBtn, { width: size, height: size, backgroundColor: colors.brand }, value >= max && { opacity: 0.4 }]}
      >
        <Ionicons name="add" size={compact ? 18 : 22} color={colors.white} />
      </Pressable>
    </View>
  );
}

/** Foto produk → gambar kategori → ikon kategori berwarna (urutan cadangan). */
export function ProductImage({ product, uri, size, style }) {
  const dim = size ? { width: size, height: size } : { width: '100%', aspectRatio: 1 };
  const src = uri || product?.image_url || product?.category_image;
  if (src) return <Image source={{ uri: src }} style={[dim, { borderRadius: radius.md, backgroundColor: colors.brandSoft }, style]} resizeMode="cover" />;
  return (
    <View style={[dim, styles.placeholder, { backgroundColor: product?.category_color || colors.brandSoft }, style]}>
      <Text style={{ fontSize: size ? size * 0.5 : 56 }}>{product?.category_icon || '🧊'}</Text>
    </View>
  );
}

/** Harga sub menu: "Rp3.000" atau "mulai Rp3.000" bila pilihannya berbeda harga. */
export function priceLabel(p) {
  return p.has_variants && p.price !== p.price_max ? `mulai ${rupiah(p.price)}` : rupiah(p.price);
}

export function ProductCard({ product, qty, onPress, onAdd, onQty, width }) {
  const soldOut = product.stock <= 0;
  const choose = product.has_variants;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.pcard, width && { width }, pressed && { opacity: 0.9 }]}>
      <ProductImage product={product} />
      <Text numberOfLines={2} style={styles.pname}>
        {product.name}
      </Text>
      <Text style={styles.pprice} numberOfLines={1}>
        {priceLabel(product)}
        {choose ? null : <Text style={styles.punit}> /{product.unit}</Text>}
      </Text>
      {choose ? (
        <Text style={styles.pvariants} numberOfLines={1}>
          {product.variants.length} pilihan {product.option_label ? product.option_label.toLowerCase() : ''}
        </Text>
      ) : null}
      <View style={{ marginTop: 'auto', paddingTop: 8 }}>
        {soldOut ? (
          <View style={[styles.addBtn, { backgroundColor: colors.line }]}>
            <Text style={[styles.addText, { color: colors.muted }]}>Stok habis</Text>
          </View>
        ) : choose ? (
          <Pressable
            accessibilityLabel={`Pilih ${product.option_label || 'pilihan'} ${product.name}`}
            onPress={() => {
              tap();
              onPress();
            }}
            style={[styles.addBtn, qty > 0 && { backgroundColor: colors.ok }]}
          >
            <Text style={styles.addText}>{qty > 0 ? `✓ ${qty} di keranjang` : `Pilih ${product.option_label || 'Pilihan'}`}</Text>
          </Pressable>
        ) : qty > 0 ? (
          <QtyStepper compact value={qty} max={product.stock} onChange={onQty} />
        ) : (
          <Pressable
            accessibilityLabel={`Tambah ${product.name} ke keranjang`}
            onPress={() => {
              tap();
              onAdd();
            }}
            style={styles.addBtn}
          >
            <Ionicons name="add" size={20} color={colors.white} />
            <Text style={styles.addText}>Tambah</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

export function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, color: colors.muted, bg: colors.line, icon: 'ellipse' };
  return (
    <View style={[styles.badge, { backgroundColor: s.bg }]}>
      <Ionicons name={s.icon} size={14} color={s.color} />
      <Text style={[styles.badgeText, { color: s.color }]}>{s.label}</Text>
    </View>
  );
}

export function Empty({ icon = 'cube-outline', title, subtitle, action }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={48} color={colors.brand} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
      {action ? <View style={{ marginTop: 20, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.empty}>
      <ActivityIndicator size="large" color={colors.brand} />
    </View>
  );
}

export function ErrorView({ message, onRetry }) {
  return <Empty icon="cloud-offline-outline" title="Oops, ada masalah" subtitle={message} action={onRetry ? <Button title="Coba Lagi" icon="refresh" onPress={onRetry} /> : null} />;
}

export function Row({ label, value, bold, color }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.bold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.bold, color && { color }]}>{value}</Text>
    </View>
  );
}

export function SectionTitle({ title, action, onAction }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={10}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Pilihan berbentuk kartu besar dengan radio (dipakai untuk pengiriman & pembayaran). */
export function OptionCard({ selected, onPress, icon, emoji, title, subtitle, right }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={() => {
        tap();
        onPress();
      }}
      style={[styles.option, selected && styles.optionActive]}
    >
      <View style={[styles.optionIcon, selected && { backgroundColor: colors.brand }]}>
        {emoji ? <Text style={{ fontSize: 22 }}>{emoji}</Text> : <Ionicons name={icon} size={24} color={selected ? colors.white : colors.brand} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.optionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.optionSub}>{subtitle}</Text> : null}
      </View>
      {right}
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={24} color={selected ? colors.brand : '#CBD5E1'} />
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  btn: {
    minHeight: 56,
    borderRadius: radius.md,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
  },
  btnSm: { minHeight: 42, paddingHorizontal: 14, borderRadius: radius.sm },
  btnText: { fontSize: font.md, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, ...shadow },
  label: { fontSize: font.sm, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  input: {
    minHeight: 54,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: font.md,
    color: colors.ink,
    backgroundColor: colors.white,
  },
  error: { color: colors.danger, marginTop: 4, fontSize: font.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  stepBtn: { borderRadius: radius.sm, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  stepVal: { minWidth: 40, textAlign: 'center', fontSize: font.lg, fontWeight: '800', color: colors.ink },
  placeholder: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  pcard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 10, ...shadow, flex: 1 },
  pname: { fontSize: font.md, fontWeight: '700', color: colors.ink, marginTop: 10, minHeight: 44 },
  pprice: { fontSize: font.md, fontWeight: '800', color: colors.brandDark, marginTop: 4 },
  punit: { fontSize: font.xs, fontWeight: '500', color: colors.muted },
  pvariants: { fontSize: font.xs, color: colors.muted, marginTop: 2 },
  addBtn: { height: 40, borderRadius: radius.sm, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  addText: { color: colors.white, fontWeight: '700', fontSize: font.sm },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  badgeText: { fontSize: font.xs, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, minHeight: 300 },
  emptyIcon: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: font.lg, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  emptySub: { fontSize: font.md, color: colors.muted, textAlign: 'center', marginTop: 6, lineHeight: 24 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
  rowLabel: { fontSize: font.md, color: colors.muted, flexShrink: 1 },
  rowValue: { fontSize: font.md, color: colors.ink, fontWeight: '600', textAlign: 'right', flexShrink: 1 },
  bold: { fontWeight: '800', color: colors.ink, fontSize: font.lg },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 12 },
  sectionTitle: { fontSize: font.lg, fontWeight: '800', color: colors.ink },
  sectionAction: { fontSize: font.sm, fontWeight: '700', color: colors.brand },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.line,
    backgroundColor: colors.white,
    marginBottom: 10,
  },
  optionActive: { borderColor: colors.brand, backgroundColor: '#F0F9FF' },
  optionIcon: { width: 46, height: 46, borderRadius: 12, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontSize: font.md, fontWeight: '700', color: colors.ink },
  optionSub: { fontSize: font.sm, color: colors.muted, marginTop: 2 },
});
