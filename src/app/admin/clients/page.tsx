import Link from 'next/link';
import { requireAdmin } from '@/lib/crm/auth';
import { ACTIVE_STATUSES } from '@/lib/crm/constants';
import { isDbConfigured, listClients } from '@/lib/crm/data';
import { fmtRub } from '@/lib/pricing';
import { inputCls } from '@/components/crm/ui';

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  if (!isDbConfigured()) return <p className="text-sm">База не подключена.</p>;
  const { q } = await searchParams;
  const clients = await listClients(q);
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <form action="/admin/clients" className="flex flex-1 gap-2">
          <input name="q" defaultValue={q} placeholder="Имя, @ник, телефон, город" className={inputCls} />
          <button className="rounded-lg border border-[var(--line)] px-3 text-sm">Найти</button>
        </form>
        <Link href="/admin/clients/new" className="whitespace-nowrap rounded-lg bg-[var(--foreground)] px-3 py-2 text-sm font-semibold text-[var(--background)]">+ Клиент</Link>
      </div>
      {clients.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--muted)]">
          {q ? 'Ничего не нашлось' : 'Клиентов пока нет. Они появятся с первыми заказами или добавьте вручную.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {clients.map((c) => {
            const spent = c.orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + (o.total_rub ?? 0), 0);
            const active = c.orders.filter((o) => ACTIVE_STATUSES.includes(o.status)).length;
            return (
              <li key={c.id}>
                <Link href={`/admin/clients/${c.id}`} className="block space-y-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 hover:border-[var(--muted)]">
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-semibold">{c.name || (c.telegram_username ? `@${c.telegram_username}` : 'Без имени')}</span>
                    <span className="text-xs text-[var(--muted)]">заказов: {c.orders.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-[var(--muted)]">
                    {c.telegram_username && <span>@{c.telegram_username}</span>}
                    {c.phone && <span>{c.phone}</span>}
                    {c.city && <span>{c.city}</span>}
                    {spent > 0 && <span className="tabular-nums">всего {fmtRub(spent)}</span>}
                    {active > 0 && <span className="text-amber-700 dark:text-amber-300">в работе: {active}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
