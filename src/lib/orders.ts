import 'server-only';
import { db } from './supabase';
import { getPricing, getVariants, getProduct, mainImage } from './catalog';
import { orderTotal } from './pricing';
import { setOrderRedeem } from './loyalty/server';
import type { TelegramUser } from './telegram';

export type OrderInput = {
  lines: { variant_id: string; qty: number }[];
  contact: { name?: string; phone?: string; telegram_username?: string; city?: string; comment?: string };
  source: 'miniapp' | 'site';
  /** Сколько бонусов клиент хочет списать; база урежет до потолка (50% комиссии) и спишет при подтверждении. */
  bonus_rub?: number;
};

export class OrderError extends Error {}

/** Создаёт заказ: clients (найти или завести) → orders → order_items → order_events(new). Цены берутся из базы, не из браузера. */
export async function createOrder(input: OrderInput, tgUser: TelegramUser | null) {
  const lines = input.lines.filter((l) => l.variant_id && Number.isInteger(l.qty) && l.qty > 0 && l.qty <= 10).slice(0, 50);
  if (!lines.length) throw new OrderError('Корзина пуста');
  const username = (tgUser?.username ?? input.contact.telegram_username ?? '').replace(/^@/, '').trim();
  const phone = (input.contact.phone ?? '').replace(/[^\d+]/g, '');
  if (!tgUser && !username && phone.length < 10) throw new OrderError('Укажите Telegram или телефон, чтобы Алия могла с вами связаться');

  const variants = await getVariants(lines.map((l) => l.variant_id));
  const byId = new Map(variants.map((v) => [v.id, v]));
  const missing = lines.filter((l) => !byId.get(l.variant_id));
  if (missing.length) throw new OrderError('Часть товаров больше не продаётся, обновите корзину');

  const pricing = await getPricing();
  const priced = lines.map((l) => ({ ...l, v: byId.get(l.variant_id)! }));
  const total = orderTotal(priced.map((p) => ({ price_thb: p.v.price_thb, qty: p.qty })), pricing);

  const client = db();
  if (!client) {
    // Без базы (демо): заказ не сохраняется
    return { id: 'demo', number: 0, totalRub: total.totalRub, bonusRub: 0, demo: true };
  }

  // Клиент
  let clientId: string | null = null;
  if (tgUser) {
    const { data } = await client.from('clients').select('id').eq('telegram_id', tgUser.id).maybeSingle();
    clientId = data?.id ?? null;
  } else if (username) {
    const { data } = await client.from('clients').select('id').ilike('telegram_username', username).is('telegram_id', null).limit(1).maybeSingle();
    clientId = data?.id ?? null;
  }
  const clientFields = {
    name: input.contact.name?.slice(0, 120) || [tgUser?.first_name, tgUser?.last_name].filter(Boolean).join(' ') || null,
    phone: phone || null,
    city: input.contact.city?.slice(0, 120) || null,
    telegram_username: username || null,
  };
  if (clientId) {
    const patch = Object.fromEntries(Object.entries(clientFields).filter(([, v]) => v));
    if (Object.keys(patch).length) await client.from('clients').update(patch).eq('id', clientId);
  } else {
    const { data, error } = await client
      .from('clients')
      .insert({ ...clientFields, telegram_id: tgUser?.id ?? null, source: input.source === 'miniapp' ? 'telegram' : 'site' })
      .select('id')
      .single();
    if (error) throw new Error(`clients: ${error.message}`);
    clientId = data.id;
  }

  // Заказ
  const { data: order, error: orderErr } = await client
    .from('orders')
    .insert({
      client_id: clientId,
      source: input.source,
      status: 'new',
      total_thb: total.totalThb,
      total_rub: total.totalRub,
      rate_rub_per_thb: pricing.thb_rub,
      commission_rub: total.commissionRub,
      pricing_snapshot: pricing,
      comment: input.contact.comment?.slice(0, 1000) || null,
    })
    .select('id, number')
    .single();
  if (orderErr) throw new Error(`orders: ${orderErr.message}`);

  const products = new Map<string, Awaited<ReturnType<typeof getProduct>>>();
  for (const pid of new Set(priced.map((p) => p.v.product_id))) products.set(pid, await getProduct(pid));

  const items = priced.map((p) => {
    const prod = products.get(p.v.product_id)?.item;
    return {
      order_id: order.id,
      variant_id: p.v.id,
      brand_id: prod?.brand_id ?? 'uniqlo',
      sku: prod?.source_id ?? null,
      color: [p.v.color_code, p.v.color_name].filter(Boolean).join(' '),
      size: p.v.size_label ?? p.v.size_code,
      name: prod?.name_ru ?? prod?.name_en ?? null,
      url: prod?.source_url ?? null,
      image_url: prod ? mainImage(prod, p.v.color_code) : null,
      qty: p.qty,
      price_thb: p.v.price_thb,
    };
  });
  const { error: itemsErr } = await client.from('order_items').insert(items);
  if (itemsErr) throw new Error(`order_items: ${itemsErr.message}`);

  // Бонусы может списать только клиент, вошедший через Telegram (иначе чужой баланс по username)
  const bonusRub = tgUser && input.bonus_rub ? await setOrderRedeem(order.id, input.bonus_rub) : 0;

  await client.from('order_events').insert({ order_id: order.id, status: 'new', created_by: 'customer' });
  return { id: order.id as string, number: order.number as number, totalRub: total.totalRub, bonusRub, demo: false };
}

export const orderNumber = (n: number) => `A-${String(n).padStart(4, '0')}`;
