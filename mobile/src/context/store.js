import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';

const StoreContext = createContext(null);

/** Info toko (ongkir, jam buka, metode bayar) & kategori. */
export function StoreProvider({ children }) {
  const [store, setStore] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api('/store'), api('/categories')]);
      setStore(s.data);
      setCategories(c.data);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loader async, setState terjadi setelah fetch
    reload();
  }, [reload]);

  const value = useMemo(() => ({ store, categories, error, reload }), [store, categories, error, reload]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export const useStore = () => useContext(StoreContext);
