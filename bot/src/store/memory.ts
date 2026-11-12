import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type {
  CatalogProduct, Client, NewOrderItem, Order, OrderEvent, OrderPatch, OrderSource, PhotoKind, Store, ItemStatus,
} from './types.ts';
import { ACTIVE_STATUSES } from './types.ts';

interface Data {
  clients: Client[];
  orders: Order[];
  photos: { order_id: string; kind: PhotoKind; telegram_file_id: string }[];
  events: OrderEvent[];
  settings: Record<string, unknown>;
  products: CatalogProduct[];
  seq: number;
}

/** Хранилище в памяти с сохранением в JSON-файл. Для локального запуска и тестов, без Supabase. */
export class MemoryStore implements Store {
  d: Data = { clients: [], orders: [], photos: [], events: [], settings: {}, products: [], seq: 0 };
  constructor(private file?: string) {
    if (file && existsSync(file)) this.d = { ...this.d, ...JSON.parse(readFileSync(file, 'utf8')) };
  }
  private save() { if (this.file) writeFileSync(this.file, JSON.stringify(this.d, null, 2)); }
  private c<T>(x: T): T { return structuredClone(x); }

  async getClientByTelegram(tid: number) {
    const c = this.d.clients.find(c => c.telegram_id === tid);
    return c ? this.c(c) : null;
  }
  async getClient(id: string) {
    const c = this.d.clients.find(c => c.id === id);
    return c ? this.c(c) : null;
  }
  async upsertTelegramClient(tid: number, patch: Partial<Omit<Client, 'id' | 'telegram_id'>>) {
    let c = this.d.clients.find(c => c.telegram_id === tid);
    if (!c) {
      c = { id: randomUUID(), telegram_id: tid, telegram_username: null, name: null, phone: null, city: null, sizes: null };
      this.d.clients.push(c);
    }
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) (c as any)[k] = v;
    this.save();
    return this.c(c);
  }

  async createOrder(i: { client_id: string; source: OrderSource; items: NewOrderItem[]; comment?: string | null }) {
    const o: Order = {
      id: randomUUID(), number: ++this.d.seq, client_id: i.client_id, source: i.source, status: 'new',
      total_thb: null, total_rub: null, carrier: null, tracking_number: null, comment: i.comment ?? null,
      created_at: new Date().toISOString(),
      items: i.items.map(it => ({ ...it, id: randomUUID(), item_status: 'pending', replacement_note: null })),
    };
    this.d.orders.push(o);
    this.save();
    return this.c(o);
  }
  async getOrder(id: string) {
    const o = this.d.orders.find(o => o.id === id);
    return o ? this.c(o) : null;
  }
  async updateOrder(id: string, patch: OrderPatch) {
    const o = this.d.orders.find(o => o.id === id);
    if (!o) throw new Error(`Заказ ${id} не найден`);
    Object.assign(o, patch);
    this.save();
    return this.c(o);
  }
  async updateItem(itemId: string, patch: { item_status?: ItemStatus; replacement_note?: string | null }) {
    for (const o of this.d.orders) {
      const it = o.items.find(i => i.id === itemId);
      if (it) { Object.assign(it, patch); this.save(); return; }
    }
    throw new Error(`Позиция ${itemId} не найдена`);
  }
  async listClientOrders(clientId: string, limit = 10) {
    return this.c(this.d.orders.filter(o => o.client_id === clientId).reverse().slice(0, limit));
  }
  async listActiveOrders() {
    return this.c(this.d.orders.filter(o => ACTIVE_STATUSES.includes(o.status)));
  }

  async addOrderPhoto(order_id: string, kind: PhotoKind, telegram_file_id: string) {
    this.d.photos.push({ order_id, kind, telegram_file_id });
    this.save();
  }
  async listOrderPhotos(orderId: string) {
    return this.d.photos.filter(p => p.order_id === orderId).map(({ kind, telegram_file_id }) => ({ kind, telegram_file_id }));
  }

  async addEvent(e: Omit<OrderEvent, 'id'>) {
    this.d.events.push({ ...e, id: this.d.events.length + 1 });
    this.save();
  }
  async listEventsAfter(cursor: number, limit = 50) {
    return this.c(this.d.events.filter(e => e.id > cursor).slice(0, limit));
  }

  async getSetting<T>(key: string) { return (this.d.settings[key] as T) ?? null; }
  async setSetting(key: string, value: unknown) { this.d.settings[key] = value; this.save(); }

  async findProduct(sourceId: string) {
    const p = this.d.products.find(p => p.source_id === sourceId);
    return p ? this.c(p) : null;
  }
}
