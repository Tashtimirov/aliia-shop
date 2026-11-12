import { STATE_TITLE_RU } from './status';
import type { CarrierEvent, ShipmentState } from './types';

/**
 * Light Logistics (Паттайя/Пхукет → Россия, lightlogistics.ru / light-global.com).
 * Публичного API у них нет (проверено 2026-11-12): трек вводится вручную,
 * статусы Алия ставит кнопками в CRM. Если менеджер Light Logistics даст API
 * или выгрузку статусов, сюда добавится fetchStatuses() по образцу cdek.ts.
 *
 * Трек-номер: 'TH' или 'PU' (Пхукет) и 10 цифр, например TH0000012345.
 */
const TRACK_RE = /^(TH|PU)\d{8,12}$/;

export function normalizeLlTrack(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  return TRACK_RE.test(t) ? t : null;
}

export function llTrackingUrl() {
  // Страница отслеживания работает через форму; прямой ссылки с номером пока не нашли.
  return 'https://lightlogistics.ru/tracking/';
}

/** Кнопки статусов в CRM для посылок Light Logistic, в порядке пути. */
export const LL_ADMIN_STEPS: { state: ShipmentState; label: string }[] = [
  { state: 'accepted', label: 'Сдала на склад Light Logistic' },
  { state: 'in_transit', label: 'Вылетело из Таиланда' },
  { state: 'customs', label: 'На таможне' },
  { state: 'arrived_russia', label: 'Прибыло в Россию' },
  { state: 'out_for_delivery', label: 'Передано курьеру' },
  { state: 'delivered', label: 'Вручено' },
  { state: 'problem', label: 'Проблема' },
];

export function llAdminEvent(state: ShipmentState, at = new Date(), city?: string): CarrierEvent {
  return {
    state,
    carrier_status_code: `ADMIN_${state.toUpperCase()}`,
    title: STATE_TITLE_RU[state],
    city: city ?? null,
    happened_at: at.toISOString(),
  };
}
