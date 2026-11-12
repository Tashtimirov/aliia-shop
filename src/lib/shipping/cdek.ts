import { cdekState, STATE_TITLE_RU } from './status';
import type { CarrierEvent, PackageDims, Recipient } from './types';

/**
 * Клиент СДЭК API v2. Документация: https://api-docs.cdek.ru/
 * Боевой адрес https://api.cdek.ru/v2, тестовый https://api.edu.cdek.ru/v2.
 * Ключи (client_id / client_secret) выдаются в личном кабинете СДЭК после заключения договора.
 */
export interface CdekConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
}

export const CDEK_PROD = 'https://api.cdek.ru/v2';
export const CDEK_TEST = 'https://api.edu.cdek.ru/v2';

export function cdekTrackingUrl(cdekNumber: string) {
  return `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(cdekNumber)}`;
}

export interface CdekStatus {
  code: string;
  name: string;
  date_time: string;
  city?: string;
}

export interface CdekOrderInfo {
  uuid: string;
  cdek_number: string | null;
  statuses: CdekStatus[];
}

export interface CreateCdekOrderInput {
  /** Наш номер, видно в ЛК СДЭК, например A-0012 */
  number: string;
  tariff_code: number; // 136 склад-склад, 137 склад-дверь, 138 дверь-склад, 139 дверь-дверь
  order_type?: 1 | 2; // 1 интернет-магазин, 2 доставка (по умолчанию)
  shipment_point: string; // ПВЗ, где Алия (или помощник в Москве) сдаёт посылку
  recipient: Recipient;
  package: PackageDims;
  comment?: string;
}

export class CdekError extends Error {
  constructor(message: string, public status?: number, public details?: unknown) {
    super(message);
  }
}

export class CdekClient {
  private token: { value: string; expiresAt: number } | null = null;
  private f: typeof fetch;

  constructor(private cfg: CdekConfig) {
    this.f = cfg.fetch ?? fetch;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
    });
    const res = await this.f(`${this.cfg.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new CdekError('Не удалось получить токен СДЭК', res.status, await safeJson(res));
    const j = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.f(`${this.cfg.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.getToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await safeJson(res);
    if (!res.ok) throw new CdekError(`СДЭК ${method} ${path}: ${res.status}`, res.status, j);
    return j as T;
  }

  /** Создать заказ. СДЭК обрабатывает его асинхронно: cdek_number появится позже (вебхук или getOrder). */
  async createOrder(input: CreateCdekOrderInput): Promise<{ uuid: string }> {
    const r = input.recipient;
    const body: Record<string, unknown> = {
      type: input.order_type ?? 2,
      number: input.number,
      tariff_code: input.tariff_code,
      comment: input.comment,
      shipment_point: input.shipment_point,
      recipient: { name: r.name, phones: [{ number: r.phone }] },
      packages: [
        {
          number: '1',
          weight: input.package.weight_g,
          length: input.package.length,
          width: input.package.width,
          height: input.package.height,
          comment: 'Одежда',
        },
      ],
    };
    if (r.pvz_code) body.delivery_point = r.pvz_code;
    else body.to_location = { code: r.city_code, address: r.address };

    const j = await this.req<{ entity?: { uuid: string }; requests?: { state: string; errors?: unknown[] }[] }>(
      'POST', '/orders', body,
    );
    const failed = j.requests?.find((x) => x.state === 'INVALID');
    if (failed || !j.entity?.uuid) throw new CdekError('СДЭК отклонил заказ', 400, j.requests);
    return { uuid: j.entity.uuid };
  }

  async getOrder(uuid: string): Promise<CdekOrderInfo> {
    const j = await this.req<{ entity: { uuid: string; cdek_number?: string; statuses?: CdekStatus[] } }>(
      'GET', `/orders/${encodeURIComponent(uuid)}`,
    );
    return { uuid: j.entity.uuid, cdek_number: j.entity.cdek_number ?? null, statuses: j.entity.statuses ?? [] };
  }

  async getOrderByNumber(cdekNumber: string): Promise<CdekOrderInfo> {
    const j = await this.req<{ entity: { uuid: string; cdek_number?: string; statuses?: CdekStatus[] } }>(
      'GET', `/orders?cdek_number=${encodeURIComponent(cdekNumber)}`,
    );
    return { uuid: j.entity.uuid, cdek_number: j.entity.cdek_number ?? null, statuses: j.entity.statuses ?? [] };
  }

  /** Подписка на смену статусов. Вызывается один раз при настройке. */
  async subscribeWebhook(url: string) {
    return this.req<{ entity: { uuid: string } }>('POST', '/webhooks', { type: 'ORDER_STATUS', url });
  }

  /** Расчёт стоимости по тарифу (для калькулятора на сайте). */
  async calcTariff(p: { tariff_code: number; from_city_code: number; to_city_code: number; weight_g: number }) {
    return this.req<{ delivery_sum: number; period_min: number; period_max: number; total_sum: number }>(
      'POST', '/calculator/tariff',
      {
        tariff_code: p.tariff_code,
        from_location: { code: p.from_city_code },
        to_location: { code: p.to_city_code },
        packages: [{ weight: p.weight_g }],
      },
    );
  }

  /** Пункты выдачи в городе (для выбора ПВЗ в личном кабинете). */
  async pickupPoints(cityCode: number) {
    return this.req<{ code: string; name: string; location: { address: string } }[]>(
      'GET', `/deliverypoints?city_code=${cityCode}&type=ALL`,
    );
  }
}

export function cdekStatusesToEvents(statuses: CdekStatus[]): CarrierEvent[] {
  return statuses
    .map((s) => {
      const state = cdekState(s.code);
      return {
        state,
        carrier_status_code: s.code,
        title: s.name || STATE_TITLE_RU[state],
        city: s.city ?? null,
        happened_at: new Date(s.date_time).toISOString(),
      };
    })
    .sort((a, b) => a.happened_at.localeCompare(b.happened_at));
}

/** Тело вебхука ORDER_STATUS от СДЭК. */
export interface CdekWebhook {
  type: string;
  uuid: string; // uuid заказа
  date_time?: string;
  attributes?: {
    cdek_number?: string;
    number?: string;
    code?: string;
    status_code?: string;
    status_date_time?: string;
    city_name?: string;
    is_return?: boolean;
    deleted?: boolean;
  };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
