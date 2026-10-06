import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';

const KEY = 'harum.cart';
const CartContext = createContext(null);

/** Keranjang disimpan di perangkat. Item: { product: {...}, quantity } */
export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setItems(JSON.parse(raw)))
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (loaded.current) AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => {});
  }, [items]);

  const value = useMemo(() => {
    const qtyOf = (id) => items.find((i) => i.product.id === id)?.quantity || 0;
    const setQty = (product, quantity) =>
      setItems((prev) => {
        const q = Math.max(0, Math.min(quantity, product.stock ?? 999));
        const exists = prev.some((i) => i.product.id === product.id);
        if (q === 0) return prev.filter((i) => i.product.id !== product.id);
        if (exists) return prev.map((i) => (i.product.id === product.id ? { product, quantity: q } : i));
        return [...prev, { product, quantity: q }];
      });
    return {
      ready,
      items,
      count: items.reduce((a, i) => a + i.quantity, 0),
      subtotal: items.reduce((a, i) => a + i.quantity * i.product.price, 0),
      qtyOf,
      setQty,
      add: (product, n = 1) => setQty(product, qtyOf(product.id) + n),
      remove: (id) => setItems((prev) => prev.filter((i) => i.product.id !== id)),
      clear: () => setItems([]),
    };
  }, [items, ready]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export const useCart = () => useContext(CartContext);
