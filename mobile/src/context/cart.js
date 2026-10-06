import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useVersion } from './realtime';

const KEY = 'harum.cart';
const CartContext = createContext(null);

/** Kunci baris keranjang: sub menu + pilihan. */
export const lineKey = (productId, variantId) => `${productId}:${variantId || 0}`;

/**
 * Keranjang disimpan di perangkat. Item: { product, variant|null, quantity }.
 * Harga, stok & ketersediaan disinkronkan otomatis ketika admin mengubah katalog.
 */
export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);
  const productsV = useVersion('products');

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setItems(JSON.parse(raw).map((i) => ({ variant: null, ...i }))))
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (loaded.current) AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});
  }, [items, ready]);

  // Segarkan data produk di keranjang saat katalog berubah (harga/stok/pilihan dihapus)
  const ids = [...new Set(items.map((i) => i.product.id))].join(',');
  useEffect(() => {
    if (!ready || !ids) return;
    api(`/products?ids=${ids}`)
      .then((r) => {
        const map = new Map(r.data.map((p) => [p.id, p]));
        setItems((prev) =>
          prev.flatMap((i) => {
            const product = map.get(i.product.id);
            if (!product) return []; // sub menu dinonaktifkan/dihapus
            let variant = null;
            if (product.has_variants) {
              variant = product.variants.find((v) => v.id === i.variant?.id);
              if (!variant) return []; // pilihan sudah tidak ada
            } else if (i.variant) return [];
            const stock = (variant || product).stock;
            const quantity = Math.min(i.quantity, stock);
            return quantity > 0 ? [{ product, variant, quantity }] : [];
          })
        );
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cukup saat katalog berubah / keranjang dimuat
  }, [ready, productsV]);

  const value = useMemo(() => {
    const find = (pid, vid) => items.find((i) => lineKey(i.product.id, i.variant?.id) === lineKey(pid, vid));
    const qtyOf = (pid, vid) => find(pid, vid)?.quantity || 0;
    /** Total qty sebuah sub menu (semua pilihan). */
    const qtyOfProduct = (pid) => items.filter((i) => i.product.id === pid).reduce((a, i) => a + i.quantity, 0);
    const setQty = (product, variant, quantity) =>
      setItems((prev) => {
        const k = lineKey(product.id, variant?.id);
        const max = (variant || product).stock ?? 999;
        const q = Math.max(0, Math.min(quantity, max));
        const exists = prev.some((i) => lineKey(i.product.id, i.variant?.id) === k);
        if (q === 0) return prev.filter((i) => lineKey(i.product.id, i.variant?.id) !== k);
        if (exists) return prev.map((i) => (lineKey(i.product.id, i.variant?.id) === k ? { product, variant: variant || null, quantity: q } : i));
        return [...prev, { product, variant: variant || null, quantity: q }];
      });
    const priceOf = (i) => (i.variant || i.product).price;
    return {
      ready,
      items,
      count: items.reduce((a, i) => a + i.quantity, 0),
      subtotal: items.reduce((a, i) => a + i.quantity * priceOf(i), 0),
      priceOf,
      qtyOf,
      qtyOfProduct,
      setQty,
      add: (product, variant, n = 1) => setQty(product, variant, qtyOf(product.id, variant?.id) + n),
      clear: () => setItems([]),
    };
  }, [items, ready]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
