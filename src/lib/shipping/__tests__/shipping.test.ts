import { describe, expect, it } from 'vitest';
import { CdekClient, CDEK_TEST } from '../cdek';
import { normalizeLlTrack } from '../lightLogistic';
import {
  addLightLogisticTrack, attachCdekNumber, createCdekShipment, handleCdekWebhook, pollCdek, setStateManually,
} from '../service';
import { cdekState, deriveOrderStatus } from '../status';
import type { Shipment } from '../types';
import { memoryStore } from './memoryStore';

type Statuses = { code: string; name: string; date_time: string; city?: string }[];

function fakeCdek(opts: { statuses?: Record<string, Statuses>; invalid?: boolean } = {}) {
  const calls: { method: string; url: string; body?: string }[] = [];
  const statuses = opts.statuses ?? {};
  let tokenCalls = 0;
  const f = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, body: typeof init?.body === 'string' ? init.body : undefined });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    const path = url.replace(CDEK_TEST, '');
    if (path === '/oauth/token') { tokenCalls++; return json({ access_token: 'tok', expires_in: 3600 }); }
    if (path === '/orders' && method === 'POST') {
      return opts.invalid
        ? json({ requests: [{ state: 'INVALID', errors: [{ message: 'bad pvz' }] }] }, 400)
        : json({ entity: { uuid: 'uuid-1' }, requests: [{ state: 'ACCEPTED' }] }, 202);
    }
    const m = path.match(/^\/orders\/(.+)$/);
    if (m) return json({ entity: { uuid: m[1], cdek_number: '1234567890', statuses: statuses[m[1]] ?? [] } });
    const n = path.match(/^\/orders\?cdek_number=(.+)$/);
    if (n) return json({ entity: { uuid: 'uuid-by-num', cdek_number: n[1], statuses: statuses['uuid-by-num'] ?? [] } });
    return json({ error: 'not found' }, 404);
  }) as typeof fetch;
  const client = new CdekClient({ baseUrl: CDEK_TEST, clientId: 'id', clientSecret: 'secret', fetch: f });
  return { client, calls, tokenCalls: () => tokenCalls };
}

const recipient = { name: 'Анна', phone: '+79990000000', pvz_code: 'MSK5' };
const createInput = {
  number: 'A-0001', tariff_code: 136, shipment_point: 'MSK1', recipient, package: { weight_g: 800 },
};

describe('Light Logistic', () => {
  it('нормализует трек', () => {
    expect(normalizeLlTrack(' th 0000012345 ')).toBe('TH0000012345');
    expect(normalizeLlTrack('PU-0000012345')).toBe('PU0000012345');
    expect(normalizeLlTrack('12345')).toBeNull();
  });

  it('доставка до двери одним плечом: shipped → in_russia → delivered', async () => {
    const m = memoryStore();
    m.addOrder('o1');
    const s = await addLightLogisticTrack(m.store, ['o1'], 'TH0000012345');
    expect(m.orders.get('o1')!.status).toBe('shipped');
    await setStateManually(m.store, s.id, 'arrived_russia');
    expect(m.orders.get('o1')!.status).toBe('in_russia');
    await setStateManually(m.store, s.id, 'delivered');
    expect(m.orders.get('o1')!.status).toBe('delivered');
    expect(m.orders.get('o1')!.events.map((e) => e.status)).toEqual(['shipped', 'in_russia', 'delivered']);
  });

  it('не даёт завести один трек дважды и проверяет формат', async () => {
    const m = memoryStore();
    m.addOrder('o1');
    await addLightLogisticTrack(m.store, ['o1'], 'TH0000012345');
    await expect(addLightLogisticTrack(m.store, ['o1'], 'TH0000012345')).rejects.toThrow('уже заведён');
    await expect(addLightLogisticTrack(m.store, ['o1'], 'abc')).rejects.toThrow('TH0000012345');
  });
});

describe('Сборная посылка Light Logistic + СДЭК по России', () => {
  it('ведёт два заказа через оба плеча', async () => {
    const m = memoryStore();
    m.addOrder('o1');
    m.addOrder('o2');
    const cdek = fakeCdek({
      statuses: {
        'uuid-1': [
          { code: 'CREATED', name: 'Создан', date_time: '2026-11-20T10:00:00+0300' },
          { code: 'ACCEPTED_AT_PICK_UP_POINT', name: 'Готов к выдаче', date_time: '2026-11-22T12:00:00+0300', city: 'Казань' },
        ],
      },
    });

    const ll = await addLightLogisticTrack(m.store, ['o1', 'o2'], 'TH0000099999');
    expect(m.orders.get('o1')!.status).toBe('shipped');
    expect(m.orders.get('o2')!.status).toBe('shipped');

    // Перед прилётом Алия заводит СДЭК-плечо для o1 (o2 заберут сами)
    const dom = await createCdekShipment(m.store, cdek.client, ['o1'], createInput);
    expect(dom.state).toBe('created');
    expect(m.orders.get('o1')!.status).toBe('shipped'); // у СДЭК ещё нет номера
    // Сборный груз прилетел в Москву: для LL это «прибыло в Россию», не «вручено»
    await setStateManually(m.store, ll.id, 'arrived_russia', 'Москва');
    expect(m.orders.get('o1')!.status).toBe('in_russia');
    expect(m.orders.get('o2')!.status).toBe('in_russia');

    const r = await handleCdekWebhook(m.store, cdek.client, {
      type: 'ORDER_STATUS', uuid: 'uuid-1', attributes: { code: 'ACCEPTED_AT_PICK_UP_POINT' },
    });
    expect(r).toMatchObject({ ok: true, newEvents: 2 });
    const s = m.shipments.get(dom.id)!;
    expect(s.tracking_number).toBe('1234567890');
    expect(s.state).toBe('at_pickup_point');
    expect(s.city).toBe('Казань');
    expect(m.orders.get('o1')!.status).toBe('in_russia');

    // Повторный вебхук ничего не задваивает
    const again = await handleCdekWebhook(m.store, cdek.client, { type: 'ORDER_STATUS', uuid: 'uuid-1' });
    expect(again).toMatchObject({ newEvents: 0, orderUpdates: [] });
  });

  it('вручение СДЭК закрывает заказ', async () => {
    const m = memoryStore();
    m.addOrder('o1', 'in_russia');
    const cdek = fakeCdek({
      statuses: { 'uuid-1': [{ code: 'DELIVERED', name: 'Вручен', date_time: '2026-11-25T15:00:00+0300' }] },
    });
    await createCdekShipment(m.store, cdek.client, ['o1'], createInput);
    await pollCdek(m.store, cdek.client);
    expect(m.orders.get('o1')!.status).toBe('delivered');
    expect(await m.store.listActive('cdek')).toHaveLength(0);
  });

  it('номер накладной, вписанный вручную, подтягивает статусы', async () => {
    const m = memoryStore();
    m.addOrder('o1', 'bought');
    const cdek = fakeCdek({
      statuses: { 'uuid-by-num': [{ code: 'RECEIVED_AT_SHIPMENT_WAREHOUSE', name: 'Принят', date_time: '2026-11-20T10:00:00Z' }] },
    });
    const s = await attachCdekNumber(m.store, cdek.client, ['o1'], ' 9876543210 ');
    expect(m.shipments.get(s.id)!.state).toBe('accepted');
    expect(m.orders.get('o1')!.status).toBe('in_russia');
  });
});

describe('Вебхук СДЭК', () => {
  it('игнорирует чужие и не те события', async () => {
    const m = memoryStore();
    const cdek = fakeCdek();
    expect(await handleCdekWebhook(m.store, cdek.client, { type: 'PRINT_FORM', uuid: 'x' })).toMatchObject({ ignored: 'type' });
    expect(await handleCdekWebhook(m.store, cdek.client, { type: 'ORDER_STATUS', uuid: 'nope' })).toMatchObject({ ignored: 'unknown_order' });
  });
});

describe('Клиент СДЭК', () => {
  it('кеширует токен и бросает ошибку при отклонённом заказе', async () => {
    const ok = fakeCdek();
    await ok.client.createOrder(createInput);
    await ok.client.getOrder('uuid-1');
    expect(ok.tokenCalls()).toBe(1);
    const body = JSON.parse(ok.calls.find((c) => c.method === 'POST' && c.url.endsWith('/orders'))!.body!);
    expect(body).toMatchObject({ type: 2, tariff_code: 136, delivery_point: 'MSK5', shipment_point: 'MSK1' });
    expect(body.recipient.phones[0].number).toBe('+79990000000');

    const bad = fakeCdek({ invalid: true });
    await expect(bad.client.createOrder(createInput)).rejects.toThrow();
  });
});

describe('Статусы', () => {
  const sh = (p: Partial<Shipment>): Shipment => ({
    id: 'x', carrier: 'cdek', leg: 'domestic', tracking_number: '1', carrier_order_id: null,
    state: 'in_transit', carrier_status_code: null, status_updated_at: null, ...p,
  });
  it('не понижает статус и не трогает отменённый', () => {
    expect(deriveOrderStatus('delivered', [sh({ state: 'in_transit' })])).toBeNull();
    expect(deriveOrderStatus('cancelled', [sh({ state: 'delivered' })])).toBeNull();
  });
  it('заявка СДЭК без посылки не переводит заказ в «в России»', () => {
    const intl = sh({ leg: 'international', carrier: 'light_logistic', state: 'in_transit' });
    expect(deriveOrderStatus('shipped', [intl, sh({ state: 'created' })])).toBeNull();
    expect(deriveOrderStatus('shipped', [intl, sh({ state: 'accepted' })])).toBe('in_russia');
  });
  it('неизвестный код СДЭК считает «в пути»', () => {
    expect(cdekState('SOMETHING_NEW')).toBe('in_transit');
    expect(cdekState('POSTOMAT_RECEIVED')).toBe('delivered');
  });
});
