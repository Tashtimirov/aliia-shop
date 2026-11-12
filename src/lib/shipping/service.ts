import { CdekClient, cdekStatusesToEvents, cdekTrackingUrl, type CdekWebhook, type CreateCdekOrderInput } from './cdek';
import { llAdminEvent, llTrackingUrl, normalizeLlTrack } from './lightLogistic';
import { deriveOrderStatus, isFinal, ORDER_MESSAGE_RU } from './status';
import type { CarrierEvent, Shipment, ShipmentState, ShipmentStore } from './types';

/**
 * Записывает события перевозчика, обновляет отправление и статусы связанных заказов.
 * Идемпотентно: повторный вебхук или опрос ничего не задвоит.
 */
export async function applyEvents(
  store: ShipmentStore,
  shipment: Shipment,
  events: CarrierEvent[],
  source: 'webhook' | 'poll' | 'admin',
): Promise<{ newEvents: number; orderUpdates: { orderId: string; status: string }[] }> {
  let newEvents = 0;
  for (const ev of events) if (await store.insertEvent(shipment.id, ev, source)) newEvents++;

  const latest = [...events].sort((a, b) => a.happened_at.localeCompare(b.happened_at)).at(-1);
  if (latest && (!shipment.status_updated_at || latest.happened_at >= shipment.status_updated_at)) {
    const patch: Record<string, unknown> = {
      state: latest.state,
      status: latest.title,
      carrier_status_code: latest.carrier_status_code,
      status_updated_at: latest.happened_at,
      city: latest.city ?? null,
    };
    if (latest.state === 'delivered') patch.delivered_at = latest.happened_at;
    await store.updateShipment(shipment.id, patch);
  }

  const orderUpdates: { orderId: string; status: string }[] = [];
  for (const o of await store.ordersOf(shipment.id)) {
    const next = deriveOrderStatus(o.status, o.shipments);
    if (next) {
      await store.setOrderStatus(o.orderId, next, ORDER_MESSAGE_RU[next] ?? next);
      orderUpdates.push({ orderId: o.orderId, status: next });
    }
  }
  return { newEvents, orderUpdates };
}

// ---------- СДЭК ----------

/** Алия нажала «Отправить СДЭК» в CRM: создаём заказ в СДЭК и отправление у нас. */
export async function createCdekShipment(
  store: ShipmentStore,
  cdek: CdekClient,
  orderIds: string[],
  input: CreateCdekOrderInput & { client_id?: string },
): Promise<Shipment> {
  const { uuid } = await cdek.createOrder(input);
  return store.createShipment(
    {
      carrier: 'cdek',
      leg: 'domestic',
      tracking_number: null, // номер СДЭК придёт позже
      carrier_order_id: uuid,
      state: 'created',
      client_id: input.client_id,
      recipient: input.recipient,
      weight_g: input.package.weight_g,
      created_by: 'system',
    },
    orderIds,
  );
}

/** Алия отправила через СДЭК сама (в офисе) и вписала номер накладной. */
export async function attachCdekNumber(
  store: ShipmentStore,
  cdek: CdekClient,
  orderIds: string[],
  cdekNumber: string,
): Promise<Shipment> {
  const info = await cdek.getOrderByNumber(cdekNumber.trim());
  const s = await store.createShipment(
    {
      carrier: 'cdek',
      leg: 'domestic',
      tracking_number: info.cdek_number ?? cdekNumber.trim(),
      carrier_order_id: info.uuid,
      state: 'created',
      tracking_url: cdekTrackingUrl(cdekNumber.trim()),
    },
    orderIds,
  );
  await applyEvents(store, s, cdekStatusesToEvents(info.statuses), 'poll');
  return s;
}

/**
 * Вебхук СДЭК. Тело вебхука не подписано, поэтому ему не верим:
 * берём только uuid и перечитываем заказ из API СДЭК своим токеном.
 */
export async function handleCdekWebhook(store: ShipmentStore, cdek: CdekClient, body: CdekWebhook) {
  if (body?.type !== 'ORDER_STATUS' || !body.uuid) return { ok: true, ignored: 'type' as const };
  const shipment = await store.findByCarrierOrderId('cdek', body.uuid);
  if (!shipment) return { ok: true, ignored: 'unknown_order' as const }; // не наш или создан не через сервис
  return { ok: true, ...(await refreshCdek(store, cdek, shipment, 'webhook')) };
}

export async function refreshCdek(
  store: ShipmentStore,
  cdek: CdekClient,
  shipment: Shipment,
  source: 'webhook' | 'poll',
) {
  if (!shipment.carrier_order_id) return { newEvents: 0, orderUpdates: [] };
  const info = await cdek.getOrder(shipment.carrier_order_id);
  if (info.cdek_number && info.cdek_number !== shipment.tracking_number) {
    await store.updateShipment(shipment.id, {
      tracking_number: info.cdek_number,
      tracking_url: cdekTrackingUrl(info.cdek_number),
    });
    shipment = { ...shipment, tracking_number: info.cdek_number };
  }
  await store.updateShipment(shipment.id, { last_polled_at: new Date().toISOString() });
  return applyEvents(store, shipment, cdekStatusesToEvents(info.statuses), source);
}

/** Страховочный опрос (cron раз в 3 часа) на случай потерянного вебхука. */
export async function pollCdek(store: ShipmentStore, cdek: CdekClient) {
  const active = await store.listActive('cdek');
  const results: { shipmentId: string; error?: string }[] = [];
  for (const s of active) {
    try {
      await refreshCdek(store, cdek, s, 'poll');
      results.push({ shipmentId: s.id });
    } catch (e) {
      results.push({ shipmentId: s.id, error: (e as Error).message });
    }
  }
  return results;
}

// ---------- Light Logistic ----------

/** Алия вписала трек Light Logistic для одного или нескольких заказов (сборная посылка). */
export async function addLightLogisticTrack(store: ShipmentStore, orderIds: string[], rawTrack: string) {
  const track = normalizeLlTrack(rawTrack);
  if (!track) throw new Error('Трек Light Logistic должен быть вида TH0000012345 или PU0000012345');
  const existing = await store.findByTracking('light_logistic', track);
  if (existing) throw new Error(`Трек ${track} уже заведён`);
  const s = await store.createShipment(
    {
      carrier: 'light_logistic',
      leg: 'international',
      tracking_number: track,
      carrier_order_id: null,
      state: 'created',
      tracking_url: llTrackingUrl(),
    },
    orderIds,
  );
  await applyEvents(store, s, [llAdminEvent('created')], 'admin');
  return s;
}

/** Кнопка статуса в CRM (для Light Logistic, у которого нет API). */
export async function setStateManually(store: ShipmentStore, shipmentId: string, state: ShipmentState, city?: string) {
  const s = await store.getShipment(shipmentId);
  if (!s) throw new Error('Отправление не найдено');
  if (isFinal(s.state) && state !== s.state) throw new Error('Отправление уже завершено');
  return applyEvents(store, s, [llAdminEvent(state, new Date(), city)], 'admin');
}
