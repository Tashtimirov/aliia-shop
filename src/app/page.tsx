import Link from 'next/link';
import { CATEGORIES, GENDERS, PAGE_SIZE, getPricing, listCatalog } from '@/lib/catalog';
import { ProductCard } from '@/components/product-card';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

function href(sp: SP, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)])), page: undefined, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/?${s}` : '/';
}

function Chip({ active, to, children }: { active: boolean; to: string; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm ${active ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]' : 'border-[var(--line)] bg-[var(--surface)]'}`}
    >
      {children}
    </Link>
  );
}

export default async function Home({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const filters = { q: one(sp.q), gender: one(sp.gender), category: one(sp.category), sale: one(sp.sale) === '1', page: Number(one(sp.page)) || 1 };
  const [{ items, total, demo }, pricing] = await Promise.all([listCatalog(filters), getPricing()]);
  const pages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {demo && (
        <div className="rounded-lg border border-dashed border-[var(--accent)] p-3 text-sm">
          Демо-режим: база не подключена, показаны примерные товары. Заказы не сохраняются.
        </div>
      )}
      <form action="/" className="flex gap-2">
        {filters.gender && <input type="hidden" name="gender" value={filters.gender} />}
        {filters.category && <input type="hidden" name="category" value={filters.category} />}
        <input
          name="q"
          defaultValue={filters.q}
          placeholder="Поиск: пуховик, heattech, артикул…"
          className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--foreground)]"
        />
        <button className="rounded-lg bg-[var(--foreground)] px-4 text-sm text-[var(--background)]">Найти</button>
      </form>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={!filters.gender} to={href(sp, { gender: undefined })}>Все</Chip>
        {Object.entries(GENDERS).map(([k, v]) => (
          <Chip key={k} active={filters.gender === k} to={href(sp, { gender: k })}>{v}</Chip>
        ))}
        <Chip active={filters.sale} to={href(sp, { sale: filters.sale ? undefined : '1' })}>Скидки</Chip>
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={!filters.category} to={href(sp, { category: undefined })}>Все категории</Chip>
        {Object.entries(CATEGORIES).map(([k, v]) => (
          <Chip key={k} active={filters.category === k} to={href(sp, { category: k })}>{v}</Chip>
        ))}
      </div>
      <div className="text-xs text-[var(--muted)]">{total} товаров в наличии</div>
      {items.length ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((it) => <ProductCard key={it.id} item={it} pricing={pricing} />)}
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-[var(--muted)]">Ничего не нашлось. Попробуйте другой запрос или напишите Алие, она поищет в магазине.</p>
      )}
      {pages > 1 && (
        <nav className="flex justify-center gap-3 py-4 text-sm">
          {filters.page > 1 && <Link href={href(sp, { page: String(filters.page - 1) })}>← Назад</Link>}
          <span className="text-[var(--muted)]">{filters.page} из {pages}</span>
          {filters.page < pages && <Link href={href(sp, { page: String(filters.page + 1) })}>Дальше →</Link>}
        </nav>
      )}
    </div>
  );
}
