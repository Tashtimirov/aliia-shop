export type Carrier = 'light_logistic' | 'cdek';
export type Leg = 'international' | 'domestic';

export type ShipmentState =
  | 'draft'
  | 'created'
  | 'accepted'
  | 'in_transit'
  | 'customs'
  | 'arrived_russia'
  | 'at_pickup_point'
  | 'out_for_delivery'
  | 'delivered'
  | 'problem'
  | 'returned'
  | 'cancelled';

export type OrderStatus =
  | 'new'
  | 'confirmed'
  | 'paid'
  | 'bought'
  | 'shipped'
  | 'in_russia'
  | 'delivered'
  | 'cancelled';

export interface Shipment {
  id: string;
  carrier: Carrier;
  leg: Leg;
  tracking_number: string | null;
  carrier_order_id: string | null;
  state: ShipmentState;
  carrier_status_code: string | null;
  status_updated_at: string | null;
}

/** Событие от перевозчика, уже приведённое к нашему виду. */
export interface CarrierEvent {
  state: ShipmentState;
  carrier_status_code: string;
  title: string;
  city?: string | null;
  happened_at: string; // ISO
}

export interface Recipient {
  name: string;
  phone: string; // +7XXXXXXXXXX
  city_code?: number; // код города СДЭК
  pvz_code?: string; // код ПВЗ СДЭК (если до пункта выдачи)
  address?: string; // если до двери
}

export interface PackageDims {
  weight_g: number;
  length?: number;
  width?: number;
  height?: number;
}

/** Доступ к базе. Реализация на Supabase — в supabaseStore.ts, в тестах — память. */
export interface ShipmentStore {
  getShipment(id: string): Promise<Shipment | null>;
  createShipment(
    data: Pick<Shipment, 'carrier' | 'leg' | 'tracking_number' | 'carrier_order_id' | 'state'> & Record<string, unknown>,
    orderIds: string[],
  ): Promise<Shipment>;
  findByCarrierOrderId(carrier: Carrier, carrierOrderId: string): Promise<Shipment | null>;
  findByTracking(carrier: Carrier, tracking: string): Promise<Shipment | null>;
  listActive(carrier: Carrier): Promise<Shipment[]>;
  updateShipment(id: string, patch: Partial<Shipment> & Record<string, unknown>): Promise<void>;
  /** Вставляет событие, если такого ещё нет. Возвращает true, если событие новое. */
  insertEvent(shipmentId: string, ev: CarrierEvent, source: 'webhook' | 'poll' | 'admin'): Promise<boolean>;
  /** Все отправления заказов, которые везёт эта посылка: [{orderId, orderStatus, shipments}] */
  ordersOf(shipmentId: string): Promise<{ orderId: string; status: OrderStatus; shipments: Shipment[] }[]>;
  /** Меняет статус заказа и пишет order_events (оттуда бот шлёт уведомление клиенту). */
  setOrderStatus(orderId: string, status: OrderStatus, message: string): Promise<void>;
}
