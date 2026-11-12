import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/crm/auth';
import { orderLabel } from '@/lib/crm/constants';
import { getClient, orderMoney } from '@/lib/crm/data';
import { fmtRub } from '@/lib/pricing';
import { ClientForm } from '@/components/crm/client-form';
import { Section, StatusPill, fmtDate } from '@/components/crm/ui';

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const data = await getClient(id);
  if (!data) notFound();
  const { client, orders } = data;
  const spent = orders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + orderMoney(o).total, 0);
  return (
    <div className="space-y-4 pb-10">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{client.name || (client.telegram_username ? `@${client.telegram_username}` : 'Клиент')}</h1>
        <p className="text-sm text-[var(--muted)]">
          С нами с {fmtDate(client.created_at)} · заказов {orders.length}{spent ? ` · всего ${fmtRub(spent)}` : ''}
          {client.telegram_id ? ' · подключён к боту' : ' · в бота не заходил'}
        </p>
      </div>
      <Section title="Заказы" action={<Link href={`/admin/orders/new?client=${client.id}`} className="text-sm font-semibold text-[var(--accent)]">+ Заказ</Link>}>
        {orders.length ? (
          <ul className="space-y-1 text-sm">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/admin/orders/${o.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 hover:bg-[var(--background)]">
                  <span className="font-mono">{orderLabel(o.number)}</span>
                  <StatusPill status={o.status} />
                  <span className="text-[var(--muted)]">{o.items_count} поз.</span>
                  {orderMoney(o).total > 0 && <span className="tabular-nums">{fmtRub(orderMoney(o).total)}</span>}
                  <span className="text-[var(--muted)]">{fmtDate(o.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-[var(--muted)]">Заказов ещё нет.</p>}
      </Section>
      <ClientForm client={client} />
    </div>
  );
}
