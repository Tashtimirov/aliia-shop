import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  CatalogProduct, Client, ItemStatus, NewOrderItem, Order, OrderEvent, OrderPatch, OrderSource, PhotoKind, Store,
} from './types.ts';
import { ACTIVE_STATUSES } from './types.ts';

const ORDER_SELECT = '*, items:order_items(*)';

/**
 * Хранилище в Supabase. Таблицы описаны в общей схеме проекта (shared/data-model.md).
 * Нужен service_role ключ: бот работает только на сервере.
 */
export class SupabaseStore implements Store {
  readonly db: SupabaseClient;
  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  private ok<T>(r: { data: T; error: any }): T {
    if (r.error) throw new Error(`Supabase: ${r.error.message}`);
    return r.data;
  }

  async getClientByTelegram(tid: number) {
    return this.ok(await this.db.from('clients').select('*').eq('telegram_id', tid).maybeSingle()) as Client | null;
  }
  async getClient(id: string) {
    return this.ok(await this.db.from('clients').select('*').eq('id', id).maybeSingle()) as Client | null;
  }
  async upsertTelegramClient(tid: number, patch: Partial<Omit<Client, 'id' | 'telegram_id'>>) {
    const row = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const existing = await this.getClientByTelegram(tid);
    if (existing) {
      if (!Object.keys(row).length) return existing;
      return this.ok(await this.db.from('clients').update(row).eq('id', existing.id).select().single()) as Client;
    }
    return this.ok(await this.db.from('clients')
      .insert({ ...row, telegram_id: tid, source: 'telegram' }).select().single()) as Client;
  }

  async createOrder(i: { client_id: string; source: OrderSource; items: NewOrderItem[]; comment?: string | null }) {
    const o = this.ok(await this.db.from('orders')
      .insert({ client_id: i.client_id, source: i.source, comment: i.comment ?? null })
      .select('id').single()) as { id: string };
    if (i.items.length) {
      this.ok(await this.db.from('order_items').insert(i.items.map(it => ({ ...it, order_id: o.id, brand_id: 'uniqlo' }))));
    }
    return (await this.getOrder(o.id))!;
  }
  async getOrder(id: string) {
    return this.ok(await this.db.from('orders').select(ORDER_SELECT).eq('id', id).maybeSingle()) as Order | null;
  }
  async updateOrder(id: string, patch: OrderPatch) {
    this.ok(await this.db.from('orders').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id));
    const o = await this.getOrder(id);
    if (!o) throw new Error(`Заказ ${id} не найден`);
    return o;
  }
  async updateItem(itemId: string, patch: { item_status?: ItemStatus; replacement_note?: string | null }) {
    this.ok(await this.db.from('order_items').update(patch).eq('id', itemId));
  }
  async listClientOrders(clientId: string, limit = 10) {
    return this.ok(await this.db.from('orders').select(ORDER_SELECT)
      .eq('client_id', clientId).order('created_at', { ascending: false }).limit(limit)) as Order[];
  }
  async listActiveOrders() {
    return this.ok(await this.db.from('orders').select(ORDER_SELECT)
      .in('status', ACTIVE_STATUSES).order('created_at')) as Order[];
  }

  async addOrderPhoto(order_id: string, kind: PhotoKind, telegram_file_id: string) {
    this.ok(await this.db.from('order_photos').insert({ order_id, kind, telegram_file_id }));
  }
  async listOrderPhotos(orderId: string) {
    return this.ok(await this.db.from('order_photos').select('kind, telegram_file_id')
      .eq('order_id', orderId).in('kind', ['item', 'label']).not('telegram_file_id', 'is', null)
      .order('created_at')) as { kind: PhotoKind; telegram_file_id: string }[];
  }

  async addEvent(e: Omit<OrderEvent, 'id'>) {
    this.ok(await this.db.from('order_events').insert(e));
  }
  async listEventsAfter(cursor: number, limit = 50) {
    return this.ok(await this.db.from('order_events').select('id, order_id, status, message, created_by')
      .gt('id', cursor).order('id').limit(limit)) as OrderEvent[];
  }

  async getSetting<T>(key: string) {
    const r = this.ok(await this.db.from('settings').select('value').eq('key', key).maybeSingle()) as { value: T } | null;
    return r?.value ?? null;
  }
  async setSetting(key: string, value: unknown) {
    this.ok(await this.db.from('settings').upsert({ key, value }));
  }

  async registerReferral(clientId: string, code: string) {
    return this.ok(await this.db.rpc('loyalty_register_referral', { p_invitee: clientId, p_code: code })) === true;
  }
  async listLoyaltyNotices(limit = 50) {
    return this.ok(await this.db.from('loyalty_notices').select('id, client_id, text')
      .is('notified_at', null).order('id').limit(limit)) as { id: number; client_id: string; text: string }[];
  }
  async markLoyaltyNoticeSent(id: number) {
    this.ok(await this.db.from('loyalty_notices').update({ notified_at: new Date().toISOString() }).eq('id', id));
  }

  async findProduct(sourceId: string): Promise<CatalogProduct | null> {
    const p = this.ok(await this.db.from('products')
      .select('source_id, name_en, name_ru, source_url, variants:product_variants(id, color_code, color_name, size_code, size_label, price_thb, in_stock)')
      .eq('brand_id', 'uniqlo').eq('source_id', sourceId).eq('is_active', true).maybeSingle()) as any;
    if (!p) return null;
    const variants = (p.variants ?? []).map((v: any) => ({
      ...v, color_name: v.color_name ?? '', size_label: v.size_label ?? v.size_code,
    }));
    return { source_id: p.source_id, name: p.name_ru ?? p.name_en, url: p.source_url, variants };
  }
}
