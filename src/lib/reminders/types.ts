// Снимок данных CRM, по которому ищутся нерешённые дела. Поля как в shared/data-model.md.
export type OrderStatus = 'new' | 'confirmed' | 'paid' | 'bought' | 'shipped' | 'in_russia' | 'delivered' | 'cancelled';
export type ShipmentState =
  | 'draft' | 'created' | 'accepted' | 'in_transit' | 'customs' | 'arrived_russia'
  | 'at_pickup_point' | 'out_for_delivery' | 'delivered' | 'problem' | 'returned' | 'cancelled';

export interface ClientRow {
  id: string;
  name: string | null;
  telegram_username: string | null;
  instagram_username: string | null;
  delivery_address: { city?: string; pvz_code?: string; address?: string; recipient_phone?: string } | null;
}

export interface OrderItemRow {
  id: string;
  name: string | null;
  size: string | null;
  item_status: 'pending' | 'bought' | 'unavailable' | 'replaced' | string;
  replacement_note: string | null;
}

export interface OrderRow {
  id: string;
  number: number;
  client_id: string;
  status: OrderStatus;
  total_rub: number | null;
  paid_rub: number | null;
  tracking_number: string | null;
  created_at: string;
  updated_at: string;
  /** Когда заказ перешёл в текущий статус (последнее order_events с этим статусом), иначе updated_at. */
  status_since: string;
  items: OrderItemRow[];
  photo_kinds: string[]; // kind из order_photos: 'item' | 'label' | ...
}

export interface ShipmentRow {
  id: string;
  carrier: 'light_logistic' | 'cdek';
  leg: 'international' | 'domestic';
  tracking_number: string | null;
  state: ShipmentState;
  status_updated_at: string | null;
  created_at: string;
  order_ids: string[];
}

export interface Snapshot {
  now: Date;
  clients: ClientRow[];
  orders: OrderRow[];
  shipments: ShipmentRow[];
}

export type Severity = 'urgent' | 'normal' | 'low';

/** Одно нерешённое дело. key стабилен между запусками: по нему не повторяем то, что отложено или уже отправлено. */
export interface Finding {
  key: string;
  rule: string;
  severity: Severity;
  title: string;       // по-русски, коротко: «A-0012 Анна: оплачен 4 дня назад, не выкуплен»
  action: string;      // что сделать
  days: number;        // сколько дней висит
  order_id?: string;
  client_id?: string;
  shipment_id?: string;
}

/** Пороги в днях. Хранятся в settings.reminders, Алия может менять. */
export interface Thresholds {
  new_unconfirmed: number;
  confirmed_unpaid: number;
  paid_unbought: number;
  bought_unshipped: number;
  shipment_silent: number;
  customs: number;
  pickup_waiting: number;
  draft_no_track: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  new_unconfirmed: 1,
  confirmed_unpaid: 2,
  paid_unbought: 3,
  bought_unshipped: 7,
  shipment_silent: 7,
  customs: 5,
  pickup_waiting: 4,
  draft_no_track: 2,
};
