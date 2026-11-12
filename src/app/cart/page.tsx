import { getPricing } from '@/lib/catalog';
import { CartView } from '@/components/cart-view';

export default async function CartPage() {
  return <CartView pricing={await getPricing()} />;
}
