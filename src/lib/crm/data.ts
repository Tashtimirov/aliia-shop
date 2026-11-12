import 'server-only';
import { connection } from 'next/server';
import { db } from '@/lib/supabase';
import { ACTIVE_STATUSES, STATUSES, type OrderStatus } from './constants';

export type ClientRow = {
  id: string;
  telegram_id: number | null;
  telegram_username: string | null;
  instagram_username: string | null;
  name: string | null;
  phone: string | null;
  city: string | null;
  sizes: Record<string, string> | null;
  delivery_address: { city?: string; pvz_code?: string; address?: string; recipient_name?: string; recipient_phone?: string } | null;
  source: string | null;
  notes: string | null;
  created_at: string;
};

export type OrderRow = {
  id: string;
  number: number;
  source: string;
  client_id: string;
  status: OrderStatus;
  total_thb: number | null;
  total_rub: number | null;
  rate_rub_per_thb: number | null;
  commission_rub: number | null;
  delivery_rub: number | null;
  paid_rub: number | null;
  carrier: string | null;
  tracking_number: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  variant_id: string | null;
  brand_id: string;
  sku: string | null;
  color: string | null;
  size: string | null;
  name: string | null;
  url: string | null;
  image_url: string | null;
  qty: number;
  price_thb: number;
  item_status: string;
  replacement_note: string | null;
};

export type PhotoRow = { id: string; order_id: string; order_item_id: string | null; kind: string; storage_path: string | null; telegram_file_id: string | null; created_at: string };
export type EventRow = { id: number; order_id: string; status: OrderStatus | null; message: string | null; created_by: string | null; created_at: string };

export type OrderListRow = OrderRow & {
  client: Pick<ClientRow, 'id' | 'name' | 'telegram_username' | 'phone'> | null;
  items_count: number;
  photos_count: number;
};

const CLIENT_BRIEF = 'id, name, telegram_username, phone';

function need() {
  const c = db();
  if (!c) throw new Error('База не подключена: задайте SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY');
  return c;
}

/** Экранирует строку поиска для фильтров PostgREST (запятые и скобки ломают or()). */
const like = (q: string) => `%${q.replace(/[%_,()\\]/g, ' ').trim()}%`;

export type OrderFilter = { status?: string; q?: string };

export async function listOrders(f: OrderFilter): Promise<OrderListRow[]> {
  await connection();
  const c = need();
  let query = c
    .from('orders')
    .select(`*, client:clients(${CLIENT_BRIEF}), order_items(count), order_photos(count)`)
    .order('created_at', { ascending: false })
    .limit(200);
  if (!f.status || f.status === 'active') query = query.in('status', ACTIVE_STATUSES);
  else if ((STATUSES as string[]).includes(f.status)) query = query.eq('status', f.status);

  const q = f.q?.trim();
  if (q) {
    const num = Number(q.replace(/^a-?0*/i, ''));
    if (/^(a-?)?\d+$/i.test(q) && Number.isInteger(num)) {
      query = query.eq('number', num);
    } else {
      const { data: found } = await c
        .from('clients')
        .select('id')
        .or(`name.ilike.${like(q)},telegram_username.ilike.${like(q.replace(/^@/, ''))},phone.ilike.${like(q)},instagram_username.ilike.${like(q.replace(/^@/, ''))}`)
        .limit(100);
      const ids = (found ?? []).map((r) => r.id);
      query = ids.length
        ? query.or(`client_id.in.(${ids.join(',')}),tracking_number.ilike.${like(q)}`)
        : query.ilike('tracking_number', like(q));
    }
  }
  const { data, error } = await query;
  if (error) throw new Error(`orders: ${error.message}`);
  return (data ?? []).map((r) => {
    const { order_items, order_photos, ...rest } = r as OrderRow & { client: OrderListRow['client']; order_items: { count: number }[]; order_photos: { count: number }[] };
    return { ...rest, items_count: order_items?.[0]?.count ?? 0, photos_count: order_photos?.[0]?.count ?? 0 };
  });
}

export async function statusCounts(): Promise<Record<string, number>> {
  await connection();
  const c = need();
  const { data } = await c.from('orders').select('status').limit(5000);
  const counts: Record<string, number> = { active: 0 };
  for (const r of data ?? []) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if ((ACTIVE_STATUSES as string[]).includes(r.status)) counts.active++;
  }
  return counts;
}

export type OrderDetail = {
  order: OrderRow;
  client: ClientRow | null;
  items: OrderItemRow[];
  photos: PhotoRow[];
  events: EventRow[];
};

export async function getOrder(id: string): Promise<OrderDetail | null> {
  await connection();
  const c = need();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: order } = await c.from('orders').select('*').eq('id', id).maybeSingle();
  if (!order) return null;
  const [client, items, photos, events] = await Promise.all([
    c.from('clients').select('*').eq('id', order.client_id).maybeSingle(),
    c.from('order_items').select('*').eq('order_id', id).order('id'),
    c.from('order_photos').select('*').eq('order_id', id).order('created_at'),
    c.from('order_events').select('*').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
  ]);
  return {
    order: order as OrderRow,
    client: (client.data as ClientRow) ?? null,
    items: (items.data as OrderItemRow[]) ?? [],
    photos: (photos.data as PhotoRow[]) ?? [],
    events: (events.data as EventRow[]) ?? [],
  };
}

export type ClientListRow = ClientRow & { orders: { status: OrderStatus; total_rub: number | null }[] };

export async function listClients(q?: string): Promise<ClientListRow[]> {
  await connection();
  const c = need();
  let query = c.from('clients').select('*, orders(status, total_rub)').order('created_at', { ascending: false }).limit(300);
  const s = q?.trim();
  if (s) {
    const u = like(s.replace(/^@/, ''));
    query = query.or(`name.ilike.${like(s)},telegram_username.ilike.${u},instagram_username.ilike.${u},phone.ilike.${like(s)},city.ilike.${like(s)}`);
  }
  const { data, error } = await query;
  if (error) throw new Error(`clients: ${error.message}`);
  return (data as ClientListRow[]) ?? [];
}

export async function getClient(id: string): Promise<{ client: ClientRow; orders: (OrderRow & { items_count: number })[] } | null> {
  await connection();
  const c = need();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: client } = await c.from('clients').select('*').eq('id', id).maybeSingle();
  if (!client) return null;
  const { data: orders } = await c.from('orders').select('*, order_items(count)').eq('client_id', id).order('created_at', { ascending: false });
  return {
    client: client as ClientRow,
    orders: (orders ?? []).map((o) => {
      const { order_items, ...rest } = o as OrderRow & { order_items: { count: number }[] };
      return { ...rest, items_count: order_items?.[0]?.count ?? 0 };
    }),
  };
}

export async function clientOptions(): Promise<Pick<ClientRow, 'id' | 'name' | 'telegram_username' | 'phone'>[]> {
  await connection();
  const { data } = await need().from('clients').select(CLIENT_BRIEF).order('name').limit(2000);
  return data ?? [];
}

/** Деньги заказа: товары в батах по курсу + комиссия = total_rub (как у витрины), к оплате = total_rub + доставка − оплачено. */
export function orderMoney(o: Pick<OrderRow, 'total_thb' | 'total_rub' | 'delivery_rub' | 'paid_rub'>) {
  const total = (o.total_rub ?? 0) + (o.delivery_rub ?? 0);
  return { total, due: total - (o.paid_rub ?? 0) };
}

export const isDbConfigured = () => !!db();
