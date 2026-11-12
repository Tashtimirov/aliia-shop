import Link from 'next/link';
import { requireAdmin } from '@/lib/crm/auth';
import { createManualOrder } from '@/lib/crm/actions';
import { clientOptions, isDbConfigured } from '@/lib/crm/data';
import { Field, Section, btnPrimaryCls, inputCls } from '@/components/crm/ui';

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  await requireAdmin();
  if (!isDbConfigured()) return <p className="text-sm">База не подключена.</p>;
  const [{ client }, clients] = await Promise.all([searchParams, clientOptions()]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Новый заказ</h1>
      <p className="text-sm text-[var(--muted)]">Для заказов из переписки в Instagram или Telegram. Вещи и фото добавляются на следующем шаге.</p>
      <Section title="Клиент">
        <form action={createManualOrder} className="space-y-3">
          <Field label="Кто заказывает">
            <select name="client_id" defaultValue={client ?? ''} required className={inputCls}>
              <option value="" disabled>Выберите клиента…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.name || 'Без имени', c.telegram_username && `@${c.telegram_username}`, c.phone].filter(Boolean).join(' · ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Комментарий"><textarea name="comment" rows={2} className={inputCls} placeholder="Что просил клиент" /></Field>
          <button className={btnPrimaryCls}>Создать заказ</button>
        </form>
        <Link href="/admin/clients/new?then=order" className="inline-block text-sm underline">Клиента нет в списке? Добавить нового</Link>
      </Section>
    </div>
  );
}
