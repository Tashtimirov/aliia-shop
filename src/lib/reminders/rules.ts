// Правила «что считается нерешённым». Чистые функции: ни базы, ни ИИ. ИИ потом только пишет сводку.
import type { ClientRow, Finding, OrderRow, ShipmentRow, Snapshot, Thresholds } from './types';
import { DEFAULT_THRESHOLDS } from './types';

const DAY = 86_400_000;
const daysSince = (iso: string | null | undefined, now: Date) =>
  iso ? Math.floor((now.getTime() - new Date(iso).getTime()) / DAY) : 0;

export const orderNo = (o: Pick<OrderRow, 'number'>) => `A-${String(o.number).padStart(4, '0')}`;
export const clientName = (c?: ClientRow) =>
  c?.name || (c?.telegram_username && '@' + c.telegram_username) || (c?.instagram_username && 'ig:' + c.instagram_username) || 'клиент';

const ACTIVE_SHIP = new Set(['accepted', 'in_transit', 'arrived_russia', 'out_for_delivery']);

export function findOpenIssues(s: Snapshot, t: Thresholds = DEFAULT_THRESHOLDS): Finding[] {
  const out: Finding[] = [];
  const clients = new Map(s.clients.map((c) => [c.id, c]));
  const shipsByOrder = new Map<string, ShipmentRow[]>();
  for (const sh of s.shipments) for (const id of sh.order_ids) shipsByOrder.set(id, [...(shipsByOrder.get(id) ?? []), sh]);

  for (const o of s.orders) {
    if (o.status === 'cancelled' || o.status === 'delivered') continue;
    const c = clients.get(o.client_id);
    const who = `${orderNo(o)} ${clientName(c)}`;
    const d = daysSince(o.status_since, s.now);
    const base = { order_id: o.id, client_id: o.client_id };
    const add = (rule: string, severity: Finding['severity'], title: string, action: string, days = d) =>
      out.push({ key: `${rule}:${o.id}`, rule, severity, title: `${who}: ${title}`, action, days, ...base });

    if (o.status === 'new' && d >= t.new_unconfirmed)
      add('new_unconfirmed', 'urgent', `новый заказ ждёт подтверждения ${d} дн.`, 'Проверить наличие и подтвердить сумму клиенту');
    if (o.status === 'confirmed' && d >= t.confirmed_unpaid)
      add('confirmed_unpaid', 'normal', `сумма подтверждена ${d} дн. назад, оплаты нет`, 'Напомнить клиенту об оплате или отменить заказ');
    if (o.status === 'paid' && d >= t.paid_unbought)
      add('paid_unbought', 'urgent', `оплачен ${d} дн. назад, ещё не выкуплен`, 'Выкупить или предложить замену/возврат');

    const paidStage = ['paid', 'bought', 'shipped', 'in_russia'].includes(o.status);
    if (paidStage && o.total_rub != null && (o.paid_rub ?? 0) < o.total_rub)
      add('underpaid', 'normal', `оплачено ${o.paid_rub ?? 0} из ${o.total_rub} ₽`, 'Запросить доплату', daysSince(o.updated_at, s.now));

    if (['bought', 'shipped', 'in_russia'].includes(o.status)) {
      const missing = ['item', 'label'].filter((k) => !o.photo_kinds.includes(k));
      if (missing.length)
        add('missing_photos', 'normal', `нет фото ${missing.map((k) => (k === 'item' ? 'вещи' : 'этикетки')).join(' и ')}`, 'Добавить фото в CRM');
    }

    if (o.status === 'bought' || o.status === 'paid') {
      const pending = o.items.filter((i) => i.item_status === 'unavailable' && !i.replacement_note);
      if (pending.length)
        add('unavailable_no_decision', 'urgent', `нет в наличии: ${pending.map((i) => i.name ?? 'вещь').join(', ')}, замена не согласована`, 'Согласовать с клиентом замену или вернуть деньги');
    }

    if (o.status === 'bought') {
      if (d >= t.bought_unshipped)
        add('bought_unshipped', 'normal', `выкуплен ${d} дн. назад, не отправлен`, 'Включить в ближайшую отправку');
      const a = c?.delivery_address;
      if (!a || !(a.pvz_code || a.address))
        add('no_address', 'normal', 'нет адреса или ПВЗ для доставки', 'Спросить у клиента адрес/ПВЗ СДЭК и телефон');
    }

    if (['shipped', 'in_russia'].includes(o.status) && !o.tracking_number && !(shipsByOrder.get(o.id) ?? []).some((x) => x.tracking_number))
      add('no_tracking', 'urgent', 'отправлен, но нет трек-номера', 'Вписать трек в CRM, чтобы клиент видел статус');
  }

  for (const sh of s.shipments) {
    const d = daysSince(sh.status_updated_at ?? sh.created_at, s.now);
    const ords = sh.order_ids.map((id) => s.orders.find((o) => o.id === id)).filter(Boolean) as OrderRow[];
    const label = `${sh.carrier === 'cdek' ? 'СДЭК' : 'Light Logistic'} ${sh.tracking_number ?? '(без номера)'}` +
      (ords.length ? ` (${ords.map(orderNo).join(', ')})` : '');
    const add = (rule: string, severity: Finding['severity'], title: string, action: string) =>
      out.push({ key: `${rule}:${sh.id}`, rule, severity, title: `${label}: ${title}`, action, days: d, shipment_id: sh.id });

    if (sh.state === 'problem') add('shipment_problem', 'urgent', 'проблема с доставкой', 'Связаться с перевозчиком и клиентом');
    else if (sh.state === 'customs' && d >= t.customs) add('customs_long', 'normal', `на таможне ${d} дн.`, 'Уточнить у перевозчика, не нужны ли документы');
    else if (sh.state === 'at_pickup_point' && d >= t.pickup_waiting) add('pickup_waiting', 'normal', `ждёт в ПВЗ ${d} дн.`, 'Напомнить клиенту забрать, пока не ушло на возврат');
    else if ((sh.state === 'draft' || sh.state === 'created') && !sh.tracking_number && d >= t.draft_no_track) add('draft_no_track', 'normal', `заведено ${d} дн. назад, номера нет`, 'Вписать номер накладной');
    else if (ACTIVE_SHIP.has(sh.state) && d >= t.shipment_silent) add('shipment_silent', 'low', `статус не менялся ${d} дн.`, sh.carrier === 'light_logistic' ? 'Спросить статус у Light Logistic и нажать кнопку в CRM' : 'Проверить на сайте СДЭК');
  }

  const rank = { urgent: 0, normal: 1, low: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || b.days - a.days);
}
