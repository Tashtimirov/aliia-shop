'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/supabase';
import { DEFAULT_PRICING } from '@/lib/pricing';
import type { Pricing } from '@/lib/types';
import { adminFromInitData, assertAdmin, clearSession, passwordMatches, setSession } from './auth';
import { ITEM_STATUS_LABEL, MANUAL_STATUSES, SIZE_FIELDS, type OrderStatus } from './constants';

// Каждое действие само проверяет вход: server actions доступны прямым POST-запросом.

function need() {
  const c = db();
  if (!c) throw new Error('База не подключена');
  return c;
}
const str = (fd: FormData, k: string, max = 500) => {
  const v = fd.get(k);
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
};
const int = (fd: FormData, k: string) => {
  const v = str(fd, k, 40);
  if (v === null) return null;
  const n = Number(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
};
const dec = (fd: FormData, k: string) => {
  const v = str(fd, k, 40);
  if (v === null) return null;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const roundUp10 = (n: number) => Math.ceil(n / 10) * 10;

async function pricing(): Promise<Pricing> {
  const { data } = await need().from('settings').select('value').eq('key', 'pricing').maybeSingle();
  return { ...DEFAULT_PRICING, ...(data?.value ?? {}) };
}

/** Пересчитывает total_thb из позиций и total_rub = баты × курс + комиссия (округление до 10 ₽, как на витрине). */
async function recalc(orderId: string) {
  const c = need();
  const [{ data: order }, { data: items }] = await Promise.all([
    c.from('orders').select('rate_rub_per_thb, commission_rub').eq('id', orderId).single(),
    c.from('order_items').select('price_thb, qty, item_status').eq('order_id', orderId),
  ]);
  if (!order) return;
  const counted = (items ?? []).filter((i) => i.item_status !== 'unavailable');
  const totalThb = counted.reduce((s, i) => s + i.price_thb * i.qty, 0);
  const rate = Number(order.rate_rub_per_thb) || (await pricing()).thb_rub;
  const totalRub = roundUp10((totalThb / 100) * rate + (order.commission_rub ?? 0));
  await c.from('orders').update({ total_thb: totalThb, total_rub: totalRub, updated_at: new Date().toISOString() }).eq('id', orderId);
}

// Вход -----------------------------------------------------------------------

export async function loginWithTelegram(initData: string): Promise<{ ok: boolean; error?: string }> {
  const admin = await adminFromInitData(initData);
  if (!admin) return { ok: false, error: 'Этот Telegram-аккаунт не в списке админов' };
  await setSession(admin);
  return { ok: true };
}

export async function loginWithPassword(_prev: { error?: string } | null, fd: FormData): Promise<{ error?: string } | null> {
  if (!passwordMatches(String(fd.get('password') ?? ''))) {
    await new Promise((r) => setTimeout(r, 800));
    return { error: 'Неверный пароль' };
  }
  await setSession({ sub: 'password', name: 'Админ' });
  redirect('/admin');
}

export async function logout() {
  await clearSession();
  redirect('/admin/login');
}

// Заказы ---------------------------------------------------------------------

export async function setOrderStatus(orderId: string, status: OrderStatus) {
  await assertAdmin();
  if (!uuid(orderId) || !MANUAL_STATUSES.includes(status)) throw new Error('Этот статус ставится автоматически');
  const c = need();
  const { data: cur } = await c.from('orders').select('status').eq('id', orderId).single();
  if (!cur || cur.status === status) return;
  const { error } = await c.from('orders').update({ status, updated_at: new Date().toISOString() }).eq('id', orderId);
  if (error) throw new Error(error.message);
  await c.from('order_events').insert({ order_id: orderId, status, created_by: 'admin' });
  refresh();
}

export async function saveOrderDetails(fd: FormData) {
  await assertAdmin();
  const id = uuid(fd.get('order_id'));
  if (!id) throw new Error('Нет заказа');
  const carrier = str(fd, 'carrier', 40);
  const { error } = await need()
    .from('orders')
    .update({
      rate_rub_per_thb: dec(fd, 'rate_rub_per_thb'),
      commission_rub: int(fd, 'commission_rub'),
      delivery_rub: int(fd, 'delivery_rub'),
      paid_rub: int(fd, 'paid_rub'),
      carrier: carrier === 'cdek' || carrier === 'light_logistic' ? carrier : null,
      tracking_number: str(fd, 'tracking_number', 60),
      comment: str(fd, 'comment', 2000),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
  await recalc(id);
  refresh();
}

function itemFields(fd: FormData) {
  const priceBaht = dec(fd, 'price_baht');
  const qty = int(fd, 'qty');
  const st = str(fd, 'item_status', 20);
  return {
    name: str(fd, 'name', 200),
    sku: str(fd, 'sku', 60),
    color: str(fd, 'color', 80),
    size: str(fd, 'size', 40),
    url: str(fd, 'url', 500),
    qty: qty && qty > 0 ? Math.min(qty, 50) : 1,
    price_thb: priceBaht ? Math.round(priceBaht * 100) : 0,
    item_status: st && st in ITEM_STATUS_LABEL ? st : 'pending',
    replacement_note: str(fd, 'replacement_note', 500),
  };
}

export async function addOrderItem(fd: FormData) {
  await assertAdmin();
  const orderId = uuid(fd.get('order_id'));
  if (!orderId) throw new Error('Нет заказа');
  const brand = str(fd, 'brand_id', 40) ?? 'uniqlo';
  const { error } = await need().from('order_items').insert({ order_id: orderId, brand_id: brand, ...itemFields(fd) });
  if (error) throw new Error(error.message);
  await recalc(orderId);
  refresh();
}

export async function updateOrderItem(fd: FormData) {
  await assertAdmin();
  const itemId = uuid(fd.get('item_id'));
  const orderId = uuid(fd.get('order_id'));
  if (!itemId || !orderId) throw new Error('Нет позиции');
  const { error } = await need().from('order_items').update(itemFields(fd)).eq('id', itemId).eq('order_id', orderId);
  if (error) throw new Error(error.message);
  await recalc(orderId);
  refresh();
}

export async function deleteOrderItem(fd: FormData) {
  await assertAdmin();
  const itemId = uuid(fd.get('item_id'));
  const orderId = uuid(fd.get('order_id'));
  if (!itemId || !orderId) throw new Error('Нет позиции');
  const c = need();
  // Фото позиции остаются у заказа, просто без привязки к вещи
  await c.from('order_photos').update({ order_item_id: null }).eq('order_item_id', itemId);
  const { error } = await c.from('order_items').delete().eq('id', itemId).eq('order_id', orderId);
  if (error) throw new Error(error.message);
  await recalc(orderId);
  refresh();
}

/** Текст клиенту: событие без статуса, бот пересылает его клиенту в Telegram. */
export async function sendClientMessage(fd: FormData) {
  await assertAdmin();
  const orderId = uuid(fd.get('order_id'));
  const message = str(fd, 'message', 3000);
  if (!orderId || !message) return;
  const { error } = await need().from('order_events').insert({ order_id: orderId, status: null, message, created_by: 'admin' });
  if (error) throw new Error(error.message);
  refresh();
}

export async function deletePhoto(fd: FormData) {
  await assertAdmin();
  const id = uuid(fd.get('photo_id'));
  if (!id) return;
  const c = need();
  const { data } = await c.from('order_photos').select('storage_path').eq('id', id).maybeSingle();
  if (data?.storage_path) await c.storage.from('order-photos').remove([data.storage_path]);
  await c.from('order_photos').delete().eq('id', id);
  refresh();
}

export async function createManualOrder(fd: FormData) {
  await assertAdmin();
  const clientId = uuid(fd.get('client_id'));
  if (!clientId) throw new Error('Выберите клиента');
  const c = need();
  const p = await pricing();
  const { data, error } = await c
    .from('orders')
    .insert({ client_id: clientId, source: 'manual', status: 'new', rate_rub_per_thb: p.thb_rub, commission_rub: p.commission_min_rub, total_thb: 0, total_rub: 0, pricing_snapshot: p, comment: str(fd, 'comment', 2000) })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  await c.from('order_events').insert({ order_id: data.id, status: 'new', created_by: 'admin' });
  redirect(`/admin/orders/${data.id}`);
}

// Клиенты --------------------------------------------------------------------

export async function saveClient(fd: FormData) {
  await assertAdmin();
  const id = uuid(fd.get('client_id'));
  const sizes: Record<string, string> = {};
  for (const [k] of SIZE_FIELDS) {
    const v = str(fd, `size_${k}`, 40);
    if (v) sizes[k] = v;
  }
  const fields = {
    name: str(fd, 'name', 120),
    telegram_username: str(fd, 'telegram_username', 64)?.replace(/^@/, '') ?? null,
    instagram_username: str(fd, 'instagram_username', 64)?.replace(/^@/, '') ?? null,
    phone: str(fd, 'phone', 40),
    city: str(fd, 'city', 120),
    source: str(fd, 'source', 20) ?? 'manual',
    notes: str(fd, 'notes', 4000),
    sizes: Object.keys(sizes).length ? sizes : null,
    delivery_address: {
      city: str(fd, 'addr_city', 120) ?? undefined,
      pvz_code: str(fd, 'addr_pvz', 40) ?? undefined,
      address: str(fd, 'addr_address', 300) ?? undefined,
      recipient_name: str(fd, 'addr_recipient', 120) ?? undefined,
      recipient_phone: str(fd, 'addr_phone', 40) ?? undefined,
    },
  };
  if (!fields.name && !fields.telegram_username && !fields.phone) throw new Error('Укажите имя, Telegram или телефон');
  const c = need();
  if (id) {
    const { error } = await c.from('clients').update(fields).eq('id', id);
    if (error) throw new Error(error.message);
    refresh();
    return;
  }
  const { data, error } = await c.from('clients').insert(fields).select('id').single();
  if (error) throw new Error(error.message);
  const after = str(fd, 'then', 20);
  redirect(after === 'order' ? `/admin/orders/new?client=${data.id}` : `/admin/clients/${data.id}`);
}
