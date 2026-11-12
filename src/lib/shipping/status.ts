import type { OrderStatus, Shipment, ShipmentState } from './types';

/** Подписи для клиента. */
export const STATE_TITLE_RU: Record<ShipmentState, string> = {
  draft: 'Готовим к отправке',
  created: 'Оформлено у перевозчика',
  accepted: 'Перевозчик принял посылку',
  in_transit: 'В пути',
  customs: 'На таможне',
  arrived_russia: 'Прибыло в Россию',
  at_pickup_point: 'Ждёт вас в пункте выдачи',
  out_for_delivery: 'Передано курьеру',
  delivered: 'Вручено',
  problem: 'Проблема с доставкой, Алия уже разбирается',
  returned: 'Возврат отправителю',
  cancelled: 'Отменено',
};

/**
 * Коды статусов СДЭК API v2 (поле `code` в statuses[] и в вебхуке ORDER_STATUS).
 * Неизвестный код считаем «в пути», чтобы не терять событие.
 */
const CDEK_MAP: Record<string, ShipmentState> = {
  CREATED: 'created',
  ACCEPTED: 'created', // заявка принята системой, посылки ещё нет
  INVALID: 'problem',
  REMOVED: 'cancelled',
  RECEIVED_AT_SHIPMENT_WAREHOUSE: 'accepted',
  READY_TO_SHIP_AT_SENDING_OFFICE: 'accepted',
  READY_FOR_SHIPMENT_IN_SENDER_CITY: 'accepted',
  ACCEPTED_IN_SENDER_CITY: 'accepted',
  TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY: 'in_transit',
  SENT_TO_TRANSIT_CITY: 'in_transit',
  ACCEPTED_IN_TRANSIT_CITY: 'in_transit',
  ACCEPTED_AT_TRANSIT_WAREHOUSE: 'in_transit',
  READY_TO_SHIP_IN_TRANSIT_OFFICE: 'in_transit',
  READY_FOR_SHIPMENT_IN_TRANSIT_CITY: 'in_transit',
  TAKEN_BY_TRANSPORTER_FROM_TRANSIT_CITY: 'in_transit',
  SENT_TO_RECIPIENT_CITY: 'in_transit',
  ACCEPTED_IN_RECIPIENT_CITY: 'in_transit',
  ACCEPTED_AT_RECIPIENT_CITY_WAREHOUSE: 'in_transit',
  PASSED_TO_TRANSIT_CARRIER: 'in_transit',
  SHIPPED_TO_DESTINATION: 'in_transit',
  IN_CUSTOMS_INTERNATIONAL: 'customs',
  IN_CUSTOMS_LOCAL: 'customs',
  CUSTOMS_COMPLETE: 'in_transit',
  ACCEPTED_AT_PICK_UP_POINT: 'at_pickup_point',
  POSTOMAT_POSTED: 'at_pickup_point',
  TAKEN_BY_COURIER: 'out_for_delivery',
  DELIVERED: 'delivered',
  POSTOMAT_RECEIVED: 'delivered',
  NOT_DELIVERED: 'problem',
  POSTOMAT_SEIZED: 'problem',
  RETURNED_TO_RECIPIENT_CITY_WAREHOUSE: 'problem',
  RETURNED_TO_TRANSIT_WAREHOUSE: 'problem',
  SENT_TO_SENDER_CITY: 'returned',
  RETURNED: 'returned',
};

export function cdekState(code: string): ShipmentState {
  return CDEK_MAP[code] ?? 'in_transit';
}

const FINAL: ShipmentState[] = ['delivered', 'returned', 'cancelled'];
export const isFinal = (s: ShipmentState) => FINAL.includes(s);

const ORDER_RANK: Record<OrderStatus, number> = {
  new: 0, confirmed: 1, paid: 2, bought: 3, shipped: 4, in_russia: 5, delivered: 6, cancelled: 99,
};

const IN_RUSSIA_INTL: ShipmentState[] = ['arrived_russia', 'at_pickup_point', 'out_for_delivery', 'delivered'];

/**
 * Какой статус должен быть у заказа по его отправлениям.
 * Схемы: (а) Light Logistic до двери клиента — одно международное плечо;
 *        (б) Light Logistic до Москвы + СДЭК до клиента — два плеча.
 * Статус заказа только растёт; отменённый не трогаем. null = менять не нужно.
 */
export function deriveOrderStatus(current: OrderStatus, shipments: Shipment[]): OrderStatus | null {
  if (current === 'cancelled') return null;
  const live = shipments.filter((s) => s.state !== 'cancelled');
  if (live.length === 0) return null;

  const intl = live.filter((s) => s.leg === 'international');
  const dom = live.filter((s) => s.leg === 'domestic');
  const finalLeg = dom.length ? dom : intl;

  let target: OrderStatus | null = null;
  if (finalLeg.some((s) => s.state === 'delivered')) target = 'delivered';
  else if (
    dom.some((s) => !['draft', 'created'].includes(s.state)) || // СДЭК реально принял посылку
    intl.some((s) => IN_RUSSIA_INTL.includes(s.state))
  ) target = 'in_russia';
  else if (live.some((s) => s.tracking_number)) target = 'shipped'; // трек есть = отправлено

  if (!target || ORDER_RANK[target] <= ORDER_RANK[current]) return null;
  return target;
}

export const ORDER_MESSAGE_RU: Partial<Record<OrderStatus, string>> = {
  shipped: 'Заказ отправлен из Таиланда',
  in_russia: 'Заказ в России, едет к вам',
  delivered: 'Заказ вручён. Спасибо, что выбрали Алию!',
};
