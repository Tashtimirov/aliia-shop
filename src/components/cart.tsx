'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { CartLine } from '@/lib/types';

type Cart = {
  lines: CartLine[];
  add: (line: CartLine) => void;
  setQty: (variantId: string, qty: number) => void;
  clear: () => void;
  count: number;
};

const CartContext = createContext<Cart | null>(null);
const KEY = 'aliia-cart-v1';

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- восстановление корзины после гидрации
      if (saved) setLines(JSON.parse(saved));
    } catch {}
  }, []);

  const persist = (next: CartLine[]) => {
    setLines(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
  };

  const value = useMemo<Cart>(
    () => ({
      lines,
      count: lines.reduce((s, l) => s + l.qty, 0),
      add: (line) => {
        const existing = lines.find((l) => l.variant_id === line.variant_id);
        persist(existing ? lines.map((l) => (l === existing ? { ...l, qty: Math.min(10, l.qty + line.qty) } : l)) : [...lines, line]);
      },
      setQty: (id, qty) => persist(qty <= 0 ? lines.filter((l) => l.variant_id !== id) : lines.map((l) => (l.variant_id === id ? { ...l, qty: Math.min(10, qty) } : l))),
      clear: () => persist([]),
    }),
    [lines],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart вне CartProvider');
  return ctx;
}

export function CartBadge() {
  const { count } = useCart();
  return (
    <span className="inline-flex items-center gap-1">
      Корзина
      {count > 0 && <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-xs text-white">{count}</span>}
    </span>
  );
}
