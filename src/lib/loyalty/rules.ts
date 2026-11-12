// Правила «Клуба Алии» для показа в интерфейсе (подсказки «+N бонусов», прогресс уровня, потолок списания).
// Считает деньги по-настоящему база (supabase/migrations/0005_loyalty.sql), здесь только те же формулы для превью.
// Без зависимостей от Next и базы, чтобы проверять node --test.

export type LoyaltyTier = { code: string; name: string; min_spent_rub: number; cashback_pct: number };

export type LoyaltyConfig = {
  tiers: LoyaltyTier[];
  max_redeem_pct_of_commission: number;
  referral_friend_rub: number;
  referral_inviter_rub: number;
  referral_min_order_rub: number;
  welcome_rub: number;
  review_rub: number;
  birthday_rub: number;
  expire_months: number;
};

export const DEFAULT_LOYALTY: LoyaltyConfig = {
  tiers: [
    { code: 'new', name: 'Новичок', min_spent_rub: 0, cashback_pct: 3 },
    { code: 'friend', name: 'Подруга', min_spent_rub: 30000, cashback_pct: 5 },
    { code: 'vip', name: 'VIP', min_spent_rub: 100000, cashback_pct: 7 },
  ],
  max_redeem_pct_of_commission: 50,
  referral_friend_rub: 500,
  referral_inviter_rub: 500,
  referral_min_order_rub: 3000,
  welcome_rub: 300,
  review_rub: 200,
  birthday_rub: 500,
  expire_months: 12,
};

const sorted = (cfg: LoyaltyConfig) => [...cfg.tiers].sort((a, b) => a.min_spent_rub - b.min_spent_rub);

export function tierByCode(code: string | null | undefined, cfg: LoyaltyConfig = DEFAULT_LOYALTY): LoyaltyTier {
  return cfg.tiers.find((t) => t.code === code) ?? sorted(cfg)[0];
}

/** Следующий уровень и сколько до него не хватает; null, если уровень максимальный. */
export function nextTier(currentCode: string, spentRub: number, cfg: LoyaltyConfig = DEFAULT_LOYALTY) {
  const cur = tierByCode(currentCode, cfg);
  const next = sorted(cfg).find((t) => t.min_spent_rub > cur.min_spent_rub);
  if (!next) return null;
  const left = Math.max(0, next.min_spent_rub - spentRub);
  const span = next.min_spent_rub - cur.min_spent_rub;
  const progress = span > 0 ? Math.min(1, Math.max(0, (spentRub - cur.min_spent_rub) / span)) : 1;
  return { tier: next, leftRub: left, progress };
}

/** Сколько бонусов вернётся за покупку на сумму rub (как в базе: вниз до рубля). */
export function cashbackRub(rub: number, pct: number): number {
  return Math.max(0, Math.floor((rub * pct) / 100));
}

/** Потолок списания в заказе: процент от комиссии, не больше доступного баланса. */
export function maxRedeemRub(commissionRub: number, availableRub: number, cfg: LoyaltyConfig = DEFAULT_LOYALTY): number {
  const cap = Math.floor((commissionRub * cfg.max_redeem_pct_of_commission) / 100);
  return Math.max(0, Math.min(cap, availableRub));
}

/** Код из ссылки: 'ref_ABC234' (start / startapp) или просто 'abc234'. */
export function parseReferralCode(param: string | null | undefined): string | null {
  const m = /^(?:ref_)?([A-Za-z0-9]{6})$/.exec((param ?? '').trim());
  return m ? m[1].toUpperCase() : null;
}

export function referralLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername.replace(/^@/, '')}?start=ref_${code}`;
}

export const BONUS_KIND_LABEL: Record<string, string> = {
  welcome: 'Приветственные',
  cashback: 'Кэшбэк за заказ',
  referral_friend: 'Подарок от подруги',
  referral_inviter: 'За приглашённую подругу',
  review: 'За отзыв',
  birthday: 'День рождения',
  manual: 'От Алии',
  redeem: 'Оплата заказа',
  redeem_refund: 'Возврат при отмене',
  cashback_reversal: 'Отмена кэшбэка',
  expire: 'Сгорели',
};
