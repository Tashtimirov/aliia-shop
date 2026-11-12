import 'server-only';
import { db } from '../supabase';
import type { TelegramUser } from '../telegram';
import { DEFAULT_LOYALTY, nextTier, referralLink, BONUS_KIND_LABEL, type LoyaltyConfig } from './rules';

export async function getLoyaltyConfig(): Promise<LoyaltyConfig> {
  const client = db();
  if (!client) return DEFAULT_LOYALTY;
  const { data } = await client.from('settings').select('value').eq('key', 'loyalty').maybeSingle();
  return { ...DEFAULT_LOYALTY, ...(data?.value ?? {}) };
}

export type LoyaltySummary = {
  tier: { code: string; name: string; cashback_pct: number };
  next: { name: string; left_rub: number; progress: number } | null;
  balance_rub: number;
  balance_any_order_rub: number;
  expiring_soon_rub: number;
  next_expiry: string | null;
  spent_12m_rub: number;
  referral_code: string | null;
  referral_link: string | null;
  history: { at: string; amount_rub: number; kind: string; label: string; comment: string | null; expires_at: string | null }[];
};

/**
 * Клиент по Telegram; при первом входе заводится (база сама начислит приветственные бонусы).
 * Null, если база не настроена.
 */
export async function ensureClient(user: TelegramUser): Promise<{ id: string } | null> {
  const client = db();
  if (!client) return null;
  const { data } = await client.from('clients').select('id').eq('telegram_id', user.id).maybeSingle();
  if (data) return data;
  const { error } = await client.from('clients').upsert(
    {
      telegram_id: user.id,
      telegram_username: user.username ?? null,
      name: [user.first_name, user.last_name].filter(Boolean).join(' ') || null,
      source: 'telegram',
    },
    { onConflict: 'telegram_id', ignoreDuplicates: true },
  );
  if (error) throw new Error(`clients: ${error.message}`);
  const { data: created } = await client.from('clients').select('id').eq('telegram_id', user.id).single();
  return created;
}

/** Сводка для кабинета. Null, если база не настроена. */
export async function getLoyaltySummary(user: TelegramUser): Promise<LoyaltySummary | null> {
  const client = db();
  if (!client) return null;
  const cl = await ensureClient(user);
  if (!cl) return null;
  const [{ data: b }, { data: tx }, cfg] = await Promise.all([
    client.from('client_bonus_balance').select('*').eq('client_id', cl.id).single(),
    client
      .from('bonus_transactions')
      .select('created_at, amount_rub, kind, comment, expires_at')
      .eq('client_id', cl.id)
      .order('created_at', { ascending: false })
      .limit(50),
    getLoyaltyConfig(),
  ]);
  if (!b) return null;
  const nt = nextTier(b.loyalty_tier, b.spent_12m_rub, cfg);
  const bot = process.env.TELEGRAM_BOT_USERNAME;
  return {
    tier: { code: b.loyalty_tier, name: b.tier_name, cashback_pct: Number(b.cashback_pct) },
    next: nt && { name: nt.tier.name, left_rub: nt.leftRub, progress: nt.progress },
    balance_rub: b.balance_rub,
    balance_any_order_rub: b.balance_any_order_rub,
    expiring_soon_rub: b.expiring_soon_rub,
    next_expiry: b.next_expiry,
    spent_12m_rub: b.spent_12m_rub,
    referral_code: b.referral_code,
    referral_link: bot && b.referral_code ? referralLink(bot, b.referral_code) : null,
    history: (tx ?? []).map((t) => ({
      at: t.created_at,
      amount_rub: t.amount_rub,
      kind: t.kind,
      label: BONUS_KIND_LABEL[t.kind] ?? t.kind,
      comment: t.comment,
      expires_at: t.amount_rub > 0 ? t.expires_at : null,
    })),
  };
}

/** Клиент хочет списать requested бонусов в новом заказе. Возвращает, сколько записано (не больше потолка). */
export async function setOrderRedeem(orderId: string, requested: number): Promise<number> {
  const client = db();
  if (!client || !Number.isFinite(requested) || requested <= 0) return 0;
  const { data: cap, error } = await client.rpc('loyalty_max_redeem', { p_order_id: orderId });
  if (error) throw new Error(`loyalty_max_redeem: ${error.message}`);
  const amount = Math.min(Math.floor(requested), Number(cap) || 0);
  if (amount <= 0) return 0;
  const { error: upErr } = await client.from('orders').update({ bonus_spent_rub: amount }).eq('id', orderId).eq('status', 'new');
  if (upErr) throw new Error(`orders.bonus_spent_rub: ${upErr.message}`);
  return amount;
}

/** Привязать приглашение по коду из ссылки. true, если бонус подруге выдан. */
export async function registerReferral(user: TelegramUser, code: string): Promise<boolean> {
  const client = db();
  if (!client) return false;
  const cl = await ensureClient(user);
  if (!cl) return false;
  const { data, error } = await client.rpc('loyalty_register_referral', { p_invitee: cl.id, p_code: code });
  if (error) throw new Error(`loyalty_register_referral: ${error.message}`);
  return data === true;
}
