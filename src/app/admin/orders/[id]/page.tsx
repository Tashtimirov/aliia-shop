import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/crm/auth';
import { addOrderItem, deleteOrderItem, deletePhoto, saveOrderDetails, sendClientMessage, updateOrderItem } from '@/lib/crm/actions';
import { CARRIER_LABEL, ITEM_STATUS_LABEL, PHOTO_KINDS, STATUS_LABEL, orderLabel, type PhotoKind } from '@/lib/crm/constants';
import { getOrder, orderMoney, type OrderDetail, type PhotoRow } from '@/lib/crm/data';
import { fmtRub, fmtThb } from '@/lib/pricing';
import { ConfirmSubmit, CopyButton, PhotoUpload, StatusButtons } from '@/components/crm/order-controls';
import { Field, Section, StatusPill, btnCls, btnPrimaryCls, fmtDateTime, inputCls } from '@/components/crm/ui';

const CLIENT_TEXT: Record<string, string> = {
  new: 'заказ принят', confirmed: 'заказ подтверждён, жду оплату', paid: 'оплата получена, скоро выкуплю',
  bought: 'вещи выкуплены, фото этикеток и вещей прикладываю', shipped: 'заказ отправлен', in_russia: 'посылка уже в России',
  delivered: 'заказ доставлен', cancelled: 'заказ отменён',
};

function trackUrl(carrier: string | null, track: string | null) {
  if (!track) return null;
  if (carrier === 'cdek') return `https://www.cdek.ru/ru/tracking/?order_id=${encodeURIComponent(track)}`;
  return null;
}

function clientMessage(d: OrderDetail) {
  const { order: o, client, items } = d;
  const m = orderMoney(o);
  const lines = [`Здравствуйте${client?.name ? `, ${client.name.split(' ')[0]}` : ''}!`, `Заказ ${orderLabel(o.number)}: ${CLIENT_TEXT[o.status]}.`];
  for (const i of items.filter((i) => i.item_status !== 'unavailable')) {
    lines.push(`• ${[i.name, i.color, i.size && `размер ${i.size}`].filter(Boolean).join(', ')}${i.qty > 1 ? ` × ${i.qty}` : ''}`);
  }
  const gone = items.filter((i) => i.item_status === 'unavailable');
  if (gone.length) lines.push(`Нет в наличии: ${gone.map((i) => i.name ?? i.sku).join(', ')}`);
  if (m.total) lines.push(`Сумма: ${fmtRub(m.total)}${m.due > 0 ? `, к оплате ${fmtRub(m.due)}` : ', оплачено'}`);
  if (o.tracking_number) {
    const url = trackUrl(o.carrier, o.tracking_number);
    lines.push(`${CARRIER_LABEL[o.carrier ?? ''] ?? 'Трек'}: ${o.tracking_number}${url ? `\nОтследить: ${url}` : ''}`);
  }
  return lines.join('\n');
}

function Photos({ photos, orderId, itemId }: { photos: PhotoRow[]; orderId: string; itemId?: string }) {
  const kinds: PhotoKind[] = itemId ? ['label', 'item'] : ['receipt', 'package'];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {kinds.map((kind) => {
        const list = photos.filter((p) => p.kind === kind);
        return (
          <div key={kind} className="space-y-1">
            <div className="text-xs font-medium text-[var(--muted)]">{PHOTO_KINDS[kind]}</div>
            <div className="flex flex-wrap items-start gap-2">
              {list.map((p) => (
                <div key={p.id} className="space-y-1">
                  <a href={`/api/crm/photos/${p.id}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- приватная ссылка с редиректом, оптимизатор картинок тут не нужен */}
                    <img src={`/api/crm/photos/${p.id}`} alt={PHOTO_KINDS[kind]} className="h-20 w-20 rounded-lg border border-[var(--line)] object-cover" loading="lazy" />
                  </a>
                  <form action={deletePhoto}>
                    <input type="hidden" name="photo_id" value={p.id} />
                    <ConfirmSubmit confirmText="Удалить">убрать</ConfirmSubmit>
                  </form>
                </div>
              ))}
              <PhotoUpload orderId={orderId} itemId={itemId} kind={kind} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ItemFields({ item }: { item?: OrderDetail['items'][number] }) {
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Название"><input name="name" defaultValue={item?.name ?? ''} className={inputCls} placeholder="Пуховик Pufftech" /></Field>
        <Field label="Артикул"><input name="sku" defaultValue={item?.sku ?? ''} className={inputCls} placeholder="475355" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Field label="Цвет"><input name="color" defaultValue={item?.color ?? ''} className={inputCls} placeholder="09 BLACK" /></Field>
        <Field label="Размер"><input name="size" defaultValue={item?.size ?? ''} className={inputCls} placeholder="M" /></Field>
        <Field label="Кол-во"><input name="qty" type="number" min={1} defaultValue={item?.qty ?? 1} className={inputCls} /></Field>
        <Field label="Цена, ฿"><input name="price_baht" inputMode="decimal" defaultValue={item ? item.price_thb / 100 : ''} className={inputCls} required /></Field>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Статус вещи">
          <select name="item_status" defaultValue={item?.item_status ?? 'pending'} className={inputCls}>
            {Object.entries(ITEM_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Замена / комментарий"><input name="replacement_note" defaultValue={item?.replacement_note ?? ''} className={inputCls} /></Field>
      </div>
      <Field label="Ссылка"><input name="url" defaultValue={item?.url ?? ''} className={inputCls} placeholder="https://www.uniqlo.com/th/…" /></Field>
    </>
  );
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const d = await getOrder(id);
  if (!d) notFound();
  const { order: o, client, items, photos, events } = d;
  const m = orderMoney(o);
  const url = trackUrl(o.carrier, o.tracking_number);
  const msg = clientMessage(d);
  const orderPhotos = photos.filter((p) => !p.order_item_id || !items.some((i) => i.id === p.order_item_id));

  return (
    <div className="space-y-4 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Заказ <span className="font-mono">{orderLabel(o.number)}</span></h1>
        <StatusPill status={o.status} />
      </div>

      <Section title="Клиент" action={client && <Link href={`/admin/clients/${client.id}`} className="text-sm underline">Карточка</Link>}>
        {client ? (
          <div className="space-y-1 text-sm">
            <div className="font-semibold">{client.name || 'Без имени'}</div>
            <div className="flex flex-wrap gap-x-3 text-[var(--muted)]">
              {client.telegram_username && <a className="underline" href={`https://t.me/${client.telegram_username}`} target="_blank" rel="noreferrer">@{client.telegram_username}</a>}
              {client.phone && <span>{client.phone}</span>}
              {client.city && <span>{client.city}</span>}
              {client.sizes && <span>размеры: {Object.entries(client.sizes).map(([k, v]) => `${k} ${v}`).join(', ')}</span>}
            </div>
            {!client.telegram_id && <p className="text-xs text-[var(--muted)]">Клиент ещё не заходил в бота, уведомления в Telegram ему не придут.</p>}
          </div>
        ) : <p className="text-sm">Клиент не найден</p>}
      </Section>

      <Section title="Статус">
        <StatusButtons orderId={o.id} status={o.status} />
      </Section>

      <Section title={`Вещи (${items.length})`}>
        {items.map((it, n) => (
          <div key={it.id} className="space-y-3 rounded-lg border border-[var(--line)] p-3">
            <div className="flex items-start gap-3">
              {it.image_url && (
                // eslint-disable-next-line @next/next/no-img-element -- картинка каталога с CDN бренда
                <img src={it.image_url} alt="" className="h-16 w-16 rounded-md object-cover" />
              )}
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold">{n + 1}. {it.name || it.sku || 'Без названия'}</div>
                <div className="text-[var(--muted)]">
                  {[it.sku && `арт. ${it.sku}`, it.color, it.size, `${it.qty} шт.`, fmtThb(it.price_thb * it.qty), ITEM_STATUS_LABEL[it.item_status]].filter(Boolean).join(' · ')}
                </div>
                {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="text-xs underline">на сайте бренда</a>}
              </div>
            </div>
            <Photos photos={photos.filter((p) => p.order_item_id === it.id)} orderId={o.id} itemId={it.id} />
            <details>
              <summary className="cursor-pointer text-sm text-[var(--muted)]">Изменить позицию</summary>
              <form action={updateOrderItem} className="mt-3 space-y-2">
                <input type="hidden" name="order_id" value={o.id} />
                <input type="hidden" name="item_id" value={it.id} />
                <ItemFields item={it} />
                <button className={btnPrimaryCls}>Сохранить позицию</button>
              </form>
              <form action={deleteOrderItem} className="mt-2">
                <input type="hidden" name="order_id" value={o.id} />
                <input type="hidden" name="item_id" value={it.id} />
                <ConfirmSubmit confirmText="Да, удалить позицию">Удалить позицию</ConfirmSubmit>
              </form>
            </details>
          </div>
        ))}
        <details className="rounded-lg border border-dashed border-[var(--line)] p-3" open={items.length === 0}>
          <summary className="cursor-pointer text-sm font-semibold">+ Добавить вещь</summary>
          <form action={addOrderItem} className="mt-3 space-y-2">
            <input type="hidden" name="order_id" value={o.id} />
            <ItemFields />
            <button className={btnPrimaryCls}>Добавить</button>
          </form>
        </details>
        <div className="space-y-1">
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">Фото заказа целиком</div>
          <Photos photos={orderPhotos} orderId={o.id} />
        </div>
      </Section>

      <Section title="Деньги и доставка">
        <form action={saveOrderDetails} className="space-y-3">
          <input type="hidden" name="order_id" value={o.id} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Курс, ₽ за 1 ฿"><input name="rate_rub_per_thb" inputMode="decimal" defaultValue={o.rate_rub_per_thb ?? ''} className={inputCls} /></Field>
            <Field label="Комиссия, ₽"><input name="commission_rub" inputMode="numeric" defaultValue={o.commission_rub ?? ''} className={inputCls} /></Field>
            <Field label="Доставка, ₽"><input name="delivery_rub" inputMode="numeric" defaultValue={o.delivery_rub ?? ''} className={inputCls} /></Field>
            <Field label="Оплачено, ₽"><input name="paid_rub" inputMode="numeric" defaultValue={o.paid_rub ?? ''} className={inputCls} /></Field>
          </div>
          <dl className="grid gap-1 text-sm tabular-nums">
            <div className="flex justify-between"><dt>Вещи</dt><dd>{fmtThb(o.total_thb ?? 0)}</dd></div>
            <div className="flex justify-between"><dt>Вещи и комиссия</dt><dd>{fmtRub(o.total_rub ?? 0)}</dd></div>
            <div className="flex justify-between"><dt>Доставка</dt><dd>{fmtRub(o.delivery_rub ?? 0)}</dd></div>
            <div className="flex justify-between border-t border-[var(--line)] pt-1 text-base font-semibold"><dt>Итого</dt><dd>{fmtRub(m.total)}</dd></div>
            <div className={`flex justify-between ${m.due > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`}>
              <dt>{m.due > 0 ? 'Осталось оплатить' : 'Оплачено полностью'}</dt><dd>{fmtRub(Math.max(m.due, 0))}</dd>
            </div>
          </dl>
          <p className="text-xs text-[var(--muted)]">Сумма пересчитывается после сохранения: баты × курс + комиссия, вещи «нет в наличии» не считаются.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Перевозчик">
              <select name="carrier" defaultValue={o.carrier ?? ''} className={inputCls}>
                <option value="">Не выбран</option>
                <option value="light_logistic">Light Logistic</option>
                <option value="cdek">СДЭК</option>
              </select>
            </Field>
            <Field label="Трек-номер"><input name="tracking_number" defaultValue={o.tracking_number ?? ''} className={inputCls} /></Field>
          </div>
          {url && <a href={url} target="_blank" rel="noreferrer" className="inline-block text-sm underline">Отследить на сайте СДЭК</a>}
          <Field label="Комментарий к заказу"><textarea name="comment" defaultValue={o.comment ?? ''} rows={3} className={inputCls} /></Field>
          <button className={btnPrimaryCls}>Сохранить</button>
        </form>
      </Section>

      <Section title="Написать клиенту">
        <form action={sendClientMessage} className="space-y-2">
          <input type="hidden" name="order_id" value={o.id} />
          <textarea name="message" rows={6} defaultValue={msg} className={inputCls} />
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnPrimaryCls} disabled={!client?.telegram_id}>Отправить через бота</button>
            <CopyButton text={msg} label="Скопировать шаблон" />
          </div>
          <p className="text-xs text-[var(--muted)]">
            {client?.telegram_id ? 'Бот перешлёт текст клиенту в Telegram.' : 'Клиент не подключён к боту: скопируйте текст и отправьте в личку или Instagram.'}
          </p>
        </form>
      </Section>

      <Section title="История">
        <ul className="space-y-1 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex gap-2">
              <span className="shrink-0 text-[var(--muted)] tabular-nums">{fmtDateTime(e.created_at)}</span>
              <span className="min-w-0 break-words">
                {e.status ? `Статус: ${STATUS_LABEL[e.status]}` : `Сообщение: ${e.message}`}
                <span className="text-[var(--muted)]"> · {e.created_by === 'admin' ? 'Алия' : e.created_by === 'customer' ? 'клиент' : 'система'}</span>
              </span>
            </li>
          ))}
          {!events.length && <li className="text-[var(--muted)]">Пока пусто</li>}
        </ul>
      </Section>
      <Link href="/admin" className={btnCls}>← Все заказы</Link>
    </div>
  );
}
