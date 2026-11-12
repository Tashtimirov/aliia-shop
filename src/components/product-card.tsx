import Link from 'next/link';
import { mainImage } from '@/lib/images';
import { cardPriceRub, fmtRub } from '@/lib/pricing';
import type { CatalogItem, Pricing } from '@/lib/types';

export function ProductCard({ item, pricing }: { item: CatalogItem; pricing: Pricing }) {
  const img = mainImage(item);
  const price = item.min_price_thb ?? item.any_min_price_thb;
  const base = item.max_base_price_thb;
  return (
    <Link href={`/p/${item.id}`} className="group block">
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-[var(--line)]">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- внешние фото бренда, без оптимизатора Next
          <img src={img} alt={item.name_en} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[var(--muted)]">нет фото</div>
        )}
        {item.on_sale && <span className="absolute left-2 top-2 rounded bg-[var(--sale)] px-1.5 py-0.5 text-[11px] font-semibold text-white">Скидка</span>}
      </div>
      <div className="mt-2 line-clamp-2 text-sm leading-snug">{item.name_ru ?? item.name_en}</div>
      {price != null && (
        <div className="mt-1 flex items-baseline gap-2">
          <span className={`font-semibold ${item.on_sale ? 'text-[var(--sale)]' : ''}`}>{fmtRub(cardPriceRub(price, pricing))}</span>
          {item.on_sale && base && base > price && <span className="text-xs text-[var(--muted)] line-through">{fmtRub(cardPriceRub(base, pricing))}</span>}
        </div>
      )}
    </Link>
  );
}
