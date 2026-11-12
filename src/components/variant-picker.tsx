'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useCart } from './cart';
import { mainImage } from '@/lib/images';
import { cardPriceRub, fmtRub, fmtThb } from '@/lib/pricing';
import type { CatalogItem, Pricing, Variant } from '@/lib/types';

export function VariantPicker({ item, variants, pricing }: { item: CatalogItem; variants: Variant[]; pricing: Pricing }) {
  const { add } = useCart();
  const colors = useMemo(() => {
    const m = new Map<string, { code: string; name: string; inStock: boolean }>();
    for (const v of variants) {
      const c = m.get(v.color_code) ?? { code: v.color_code, name: v.color_name ?? `Цвет ${v.color_code}`, inStock: false };
      c.inStock ||= v.in_stock;
      m.set(v.color_code, c);
    }
    return [...m.values()].sort((a, b) => Number(b.inStock) - Number(a.inStock));
  }, [variants]);
  const [color, setColor] = useState(colors[0]?.code);
  const sizes = variants.filter((v) => v.color_code === color);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const selected = variants.find((v) => v.id === variantId) ?? null;
  const shown = selected ?? sizes.find((v) => v.in_stock) ?? sizes[0];
  const img = mainImage(item, color);
  const extra = item.images.filter((i) => i.url !== img).slice(0, 6);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-2">
        <div className="aspect-[3/4] overflow-hidden rounded-lg bg-[var(--line)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {img ? <img src={img} alt={item.name_en} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">нет фото</div>}
        </div>
        {extra.length > 0 && (
          <div className="flex gap-2 overflow-x-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {extra.map((i) => <img key={i.url} src={i.url} alt="" loading="lazy" className="h-20 w-16 flex-none rounded object-cover" />)}
          </div>
        )}
      </div>
      <div className="space-y-5">
        <h1 className="text-xl font-semibold leading-tight">{item.name_ru ?? item.name_en}</h1>
        {shown && (
          <div className="flex items-baseline gap-3">
            <span className={`text-2xl font-semibold ${shown.price_thb < shown.base_price_thb ? 'text-[var(--sale)]' : ''}`}>{fmtRub(cardPriceRub(shown.price_thb, pricing))}</span>
            {shown.price_thb < shown.base_price_thb && <span className="text-sm text-[var(--muted)] line-through">{fmtRub(cardPriceRub(shown.base_price_thb, pricing))}</span>}
            <span className="text-xs text-[var(--muted)]">{fmtThb(shown.price_thb)} в магазине</span>
          </div>
        )}
        <div>
          <div className="mb-2 text-sm text-[var(--muted)]">Цвет: {colors.find((c) => c.code === color)?.name}</div>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => (
              <button
                key={c.code}
                onClick={() => { setColor(c.code); setVariantId(null); setAdded(false); }}
                className={`rounded-full border px-3 py-1.5 text-sm ${c.code === color ? 'border-[var(--foreground)]' : 'border-[var(--line)]'} ${c.inStock ? '' : 'opacity-40'}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm text-[var(--muted)]">Размер</div>
          <div className="flex flex-wrap gap-2">
            {sizes.map((v) => (
              <button
                key={v.id}
                disabled={!v.in_stock}
                onClick={() => { setVariantId(v.id); setAdded(false); }}
                className={`min-w-12 rounded-lg border px-3 py-2 text-sm ${v.id === variantId ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]' : 'border-[var(--line)] bg-[var(--surface)]'} disabled:cursor-not-allowed disabled:line-through disabled:opacity-40`}
              >
                {v.size_label ?? v.size_code}
              </button>
            ))}
          </div>
        </div>
        <button
          disabled={!selected}
          onClick={() => {
            if (!selected) return;
            add({
              variant_id: selected.id,
              product_id: item.id,
              source_id: item.source_id,
              name: item.name_ru ?? item.name_en,
              color: colors.find((c) => c.code === selected.color_code)?.name ?? selected.color_code,
              size: selected.size_label ?? selected.size_code,
              image_url: mainImage(item, selected.color_code),
              url: item.source_url,
              price_thb: selected.price_thb,
              qty: 1,
            });
            setAdded(true);
          }}
          className="w-full rounded-lg bg-[var(--accent)] py-3 font-medium text-white disabled:opacity-40"
        >
          {selected ? 'В корзину' : 'Выберите размер'}
        </button>
        {added && (
          <p className="text-sm">
            Добавлено. <Link href="/cart" className="underline">Перейти в корзину</Link>
          </p>
        )}
        <p className="text-xs leading-relaxed text-[var(--muted)]">
          Наличие с сайта Uniqlo Таиланд, обновляется ежедневно. Алия выкупает вещь в магазине в день заказа и присылает фото вещи и этикетки.
        </p>
      </div>
    </div>
  );
}
