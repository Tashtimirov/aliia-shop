import type { CarrierEvent, OrderStatus, Shipment, ShipmentStore } from '../types';

export function memoryStore() {
  const shipments = new Map<string, Shipment & { [k: string]: unknown }>();
  const links: { shipment_id: string; order_id: string }[] = [];
  const events: (CarrierEvent & { shipment_id: string; source: string })[] = [];
  const orders = new Map<string, { status: OrderStatus; events: { status: OrderStatus; message: string }[] }>();
  let seq = 0;

  const store: ShipmentStore = {
    async getShipment(id) { return shipments.get(id) ?? null; },
    async createShipment(data, orderIds) {
      const s = { id: `s${++seq}`, carrier_status_code: null, status_updated_at: null, ...data } as Shipment & { [k: string]: unknown };
      shipments.set(s.id, s);
      for (const o of orderIds) links.push({ shipment_id: s.id, order_id: o });
      return s;
    },
    async findByCarrierOrderId(c, u) { return [...shipments.values()].find((s) => s.carrier === c && s.carrier_order_id === u) ?? null; },
    async findByTracking(c, t) { return [...shipments.values()].find((s) => s.carrier === c && s.tracking_number === t) ?? null; },
    async listActive(c) { return [...shipments.values()].filter((s) => s.carrier === c && !['delivered', 'returned', 'cancelled'].includes(s.state)); },
    async updateShipment(id, patch) { shipments.set(id, { ...shipments.get(id)!, ...patch }); },
    async insertEvent(id, ev, source) {
      if (events.some((e) => e.shipment_id === id && e.carrier_status_code === ev.carrier_status_code && e.happened_at === ev.happened_at)) return false;
      events.push({ ...ev, shipment_id: id, source });
      return true;
    },
    async ordersOf(id) {
      return links.filter((l) => l.shipment_id === id).map((l) => ({
        orderId: l.order_id,
        status: orders.get(l.order_id)!.status,
        shipments: links.filter((x) => x.order_id === l.order_id).map((x) => shipments.get(x.shipment_id)!),
      }));
    },
    async setOrderStatus(id, status, message) {
      const o = orders.get(id)!;
      o.status = status;
      o.events.push({ status, message });
    },
  };

  return {
    store, shipments, events, orders,
    addOrder(id: string, status: OrderStatus = 'bought') { orders.set(id, { status, events: [] }); },
  };
}
