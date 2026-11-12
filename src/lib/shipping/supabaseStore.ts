import type { SupabaseClient } from '@supabase/supabase-js';
import type { Carrier, CarrierEvent, OrderStatus, Shipment, ShipmentStore } from './types';

const COLS = 'id, carrier, leg, tracking_number, carrier_order_id, state, carrier_status_code, status_updated_at';

/** Реализация хранилища на Supabase. Клиент создаётся с service_role ключом (только на сервере). */
export function supabaseStore(db: SupabaseClient): ShipmentStore {
  const one = async (q: PromiseLike<{ data: unknown; error: unknown }>) => {
    const { data, error } = await q;
    if (error) throw error;
    return (data as Shipment | null) ?? null;
  };

  return {
    getShipment: (id) => one(db.from('shipments').select(COLS).eq('id', id).maybeSingle()),
    findByCarrierOrderId: (carrier: Carrier, uuid: string) =>
      one(db.from('shipments').select(COLS).eq('carrier', carrier).eq('carrier_order_id', uuid).maybeSingle()),
    findByTracking: (carrier: Carrier, t: string) =>
      one(db.from('shipments').select(COLS).eq('carrier', carrier).eq('tracking_number', t).maybeSingle()),

    async createShipment(data, orderIds) {
      const { data: s, error } = await db.from('shipments').insert(data).select(COLS).single();
      if (error) throw error;
      const { error: e2 } = await db
        .from('shipment_orders')
        .insert(orderIds.map((order_id) => ({ shipment_id: (s as Shipment).id, order_id })));
      if (e2) throw e2;
      return s as Shipment;
    },

    async listActive(carrier) {
      const { data, error } = await db
        .from('shipments')
        .select(COLS)
        .eq('carrier', carrier)
        .not('state', 'in', '(delivered,returned,cancelled)');
      if (error) throw error;
      return (data ?? []) as Shipment[];
    },

    async updateShipment(id, patch) {
      const { error } = await db.from('shipments').update(patch).eq('id', id);
      if (error) throw error;
    },

    async insertEvent(shipmentId, ev: CarrierEvent, source) {
      const { data, error } = await db
        .from('shipment_events')
        .upsert(
          { shipment_id: shipmentId, ...ev, source },
          { onConflict: 'shipment_id,carrier_status_code,happened_at', ignoreDuplicates: true },
        )
        .select('id');
      if (error) throw error;
      return (data ?? []).length > 0;
    },

    async ordersOf(shipmentId) {
      const { data, error } = await db
        .from('shipment_orders')
        .select(`order_id, orders!inner(status, shipment_orders(shipments(${COLS})))`)
        .eq('shipment_id', shipmentId);
      if (error) throw error;
      type Row = {
        order_id: string;
        orders: { status: OrderStatus; shipment_orders: { shipments: Shipment }[] };
      };
      return ((data ?? []) as unknown as Row[]).map((r) => ({
        orderId: r.order_id,
        status: r.orders.status,
        shipments: r.orders.shipment_orders.map((x) => x.shipments),
      }));
    },

    async setOrderStatus(orderId, status, message) {
      // Основной трек для клиента в orders.carrier / tracking_number: последнее плечо с номером
      const { data: links } = await db
        .from('shipment_orders')
        .select('shipments(carrier, leg, tracking_number)')
        .eq('order_id', orderId);
      const ships = ((links ?? []) as unknown as { shipments: Shipment }[])
        .map((l) => l.shipments)
        .filter((s) => s.tracking_number);
      const main = ships.find((s) => s.leg === 'domestic') ?? ships[0];

      const { error } = await db
        .from('orders')
        .update({
          status,
          updated_at: new Date().toISOString(),
          ...(main ? { carrier: main.carrier, tracking_number: main.tracking_number } : {}),
        })
        .eq('id', orderId);
      if (error) throw error;
      const { error: e2 } = await db
        .from('order_events')
        .insert({ order_id: orderId, status, message, created_by: 'system' });
      if (e2) throw e2;
    },
  };
}
