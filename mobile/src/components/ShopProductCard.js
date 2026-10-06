import { router } from 'expo-router';
import { useCart } from '../context/cart';
import { ProductCard } from './ui';

/**
 * Kartu produk yang terhubung ke keranjang.
 * Sub menu tanpa pilihan: tombol Tambah / stepper langsung di kartu.
 * Sub menu berpilihan (ukuran/rasa/porsi): buka detail untuk memilih.
 */
export default function ShopProductCard({ product: p }) {
  const cart = useCart();
  return (
    <ProductCard
      product={p}
      qty={p.has_variants ? cart.qtyOfProduct(p.id) : cart.qtyOf(p.id)}
      onPress={() => router.push(`/product/${p.id}`)}
      onAdd={() => cart.add(p, null)}
      onQty={(n) => cart.setQty(p, null, n)}
    />
  );
}
