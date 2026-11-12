import type { Pricing } from './store/types.ts';

export const DEFAULT_PRICING: Pricing = { thb_rub: 2.6, commission_pct: 15, commission_min_rub: 500 };

/** Цена вещи в рублях без доставки: бат × курс + комиссия (процент, но не меньше минимума). satang — сатанги. */
export function itemPriceRub(satang: number, p: Pricing): number {
  const base = (satang / 100) * p.thb_rub;
  const commission = Math.max(base * p.commission_pct / 100, p.commission_min_rub);
  return Math.ceil((base + commission) / 10) * 10;
}

/** Сумма заказа в рублях без доставки. Комиссия-минимум берётся на заказ, а не на каждую вещь. */
export function orderPriceRub(items: { price_thb: number; qty: number }[], p: Pricing): number | null {
  if (!items.length || items.some(i => !i.price_thb)) return null;
  const base = items.reduce((s, i) => s + (i.price_thb / 100) * i.qty, 0) * p.thb_rub;
  const commission = Math.max(base * p.commission_pct / 100, p.commission_min_rub);
  return Math.ceil((base + commission) / 10) * 10;
}

export const fmtRub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
export const fmtThb = (satang: number) => `${(satang / 100).toLocaleString('ru-RU')} ฿`;

/** «1 290», «1290 бат», «1,290.00» → сатанги */
export function parseThb(text: string): number | null {
  const s = text.replace(/[\s ฿]|бат(ов|а)?|thb/gi, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n < 1_000_000 ? Math.round(n * 100) : null;
}
export function parseRub(text: string): number | null {
  const s = text.replace(/[\s ₽]|руб(лей|ля)?|р\.?$/gi, '');
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n) : null;
}
