import Link from 'next/link';
import { requireAdmin } from '@/lib/crm/auth';
import { CARRIER_LABEL, STATUSES, STATUS_LABEL, orderLabel } from '@/lib/crm/constants';
import { isDbConfigured, listOrders, orderMoney, statusCounts } from '@/lib/crm/data';
import { fmtRub } from '@/lib/pricing';
import { StatusPill, fmtDate, inputCls } from '@/components/crm/ui';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  if (!isDbConfigured()) return <p className="text-sm">База не подключена: задайте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY.</p>;
  const sp = await searchParams;
  const status = one(sp.status) ?? 'active';
  const q = one(sp.q);
  const [orders, counts] = await Promise.all([listOrders({ status, q }), statusCounts()]);
  const chips: [string, string][] = [['active', 'В работе'], ...STATUSES.map((s) => [s, STATUS_LABEL[s]] as [string, string]), ['all', 'Все']];
  const total = Object.entries(counts).filter(([k]) => k !== 'active').reduce((s, [, n]) => s + n, 0);
  const link = (s: string) => `/admin?${new URLSearchParams({ status: s, ...(q ? { q } : {}) })}`;

  return (
    <div className="space-y-4">
      <form action="/admin" className="flex gap-2">
        <input type="hidden" name="status" value={status} />
        <input name="q" defaultValue={q} placeholder="Номер, имя, @ник, телефон или трек" className={inputCls} />
        <button className="rounded-lg border border-[var(--line)] px-3 text-sm">Найти</button>
      </form>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {chips.map(([k, label]) => (
          <Link
            key={k}
            href={link(k)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-sm ${status === k ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]' : 'border-[var(--line)] bg-[var(--surface)]'}`}
          >
            {label} <span className="text-xs opacity-70">{k === 'all' ? total : counts[k] ?? 0}</span>
          </Link>
        ))}
      </div>

      {orders.length === 0 ? (
        <div className="space-y-2 rounded-xl border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--muted)]">
          <p className="font-semibold text-[var(--foreground)]">{q ? 'Ничего не нашлось' : 'Заказов в этом статусе нет'}</p>
          <p>Заказы с сайта и из бота появляются здесь сами. Заказ из переписки заводится кнопкой «+ Заказ».</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => {
            const m = orderMoney(o);
            return (
              <li key={o.id}>
                <Link href={`/admin/orders/${o.id}`} className="block space-y-1 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 hover:border-[var(--muted)]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-semibold">
                      {o.client?.name || (o.client?.telegram_username ? `@${o.client.telegram_username}` : 'Без имени')}
                    </span>
                    <StatusPill status={o.status} />
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
                    <span className="font-mono">{orderLabel(o.number)}</span>
                    <span>{o.items_count} поз.</span>
                    {m.total > 0 && <span className="tabular-nums">{fmtRub(m.total)}</span>}
                    {m.total > 0 && m.due > 0 && <span className="text-amber-700 dark:text-amber-300">долг {fmtRub(m.due)}</span>}
                    <span>{o.photos_count ? `фото: ${o.photos_count}` : 'без фото'}</span>
                    {o.tracking_number && <span>{CARRIER_LABEL[o.carrier ?? ''] ?? 'трек'} {o.tracking_number}</span>}
                    <span>{fmtDate(o.created_at)}</span>
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
