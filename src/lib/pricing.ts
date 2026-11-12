import type { Pricing } from './types';

// Та же формула, что у бота (telegram-bot/src/pricing.ts): бат × курс + комиссия,
// минимальная комиссия берётся на заказ, а не на каждую вещь.
export const DEFAULT_PRICING: Pricing = { thb_rub: 2.6, commission_pct: 15, commission_min_rub: 500 };

const roundUp10 = (n: number) => Math.ceil(n / 10) * 10;

/** Цена вещи на карточке: бат × курс + процент комиссии (без минимальной комиссии и доставки). */
export function cardPriceRub(satang: number, p: Pricing): number {
  const base = (satang / 100) * p.thb_rub;
  return roundUp10(base * (1 + p.commission_pct / 100));
}

/** Итог заказа без доставки. */
export function orderTotal(items: { price_thb: number; qty: number }[], p: Pricing) {
  const totalThb = items.reduce((s, i) => s + i.price_thb * i.qty, 0);
  const base = (totalThb / 100) * p.thb_rub;
  const commission = Math.round(Math.max((base * p.commission_pct) / 100, p.commission_min_rub));
  return { totalThb, commissionRub: commission, totalRub: roundUp10(base + commission) };
}

export const fmtRub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
export const fmtThb = (satang: number) => `${(satang / 100).toLocaleString('ru-RU')} ฿`;
