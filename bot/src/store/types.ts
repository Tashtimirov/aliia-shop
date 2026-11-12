// Модель данных бота. Повторяет общую схему проекта: /mnt/project-files/shared/data-model.md
// (владелец схемы — ветка каталога и сайта). Деньги: баты в сатангах, рубли целыми.

export type OrderStatus =
  | 'new' | 'confirmed' | 'paid' | 'bought' | 'shipped' | 'in_russia' | 'delivered' | 'cancelled';
export type OrderSource = 'miniapp' | 'site' | 'bot_link' | 'manual';
export type Carrier = 'cdek' | 'light_logistic';
export type PhotoKind = 'item' | 'label';
export type ItemStatus = 'pending' | 'bought' | 'unavailable' | 'replaced';
export type EventAuthor = 'customer' | 'admin' | 'system';

export interface Sizes { top?: string; bottom?: string; shoes?: string; height?: number }

export interface Client {
  id: string;
  telegram_id: number | null;
  telegram_username: string | null;
  name: string | null;
  phone: string | null;
  city: string | null;
  sizes: Sizes | null;
}

export interface NewOrderItem {
  variant_id?: string | null;
  sku: string | null;          // код товара Uniqlo, например E465185-000
  url: string | null;
  name: string | null;
  color: string | null;
  size: string | null;
  qty: number;
  price_thb: number;           // сатанги; 0, если цена неизвестна
}
export interface OrderItem extends NewOrderItem {
  id: string;
  item_status: ItemStatus;
  replacement_note: string | null;
}

export interface Order {
  id: string;
  number: number;
  client_id: string;
  source: OrderSource;
  status: OrderStatus;
  total_thb: number | null;
  total_rub: number | null;
  carrier: Carrier | null;
  tracking_number: string | null;
  comment: string | null;
  created_at: string;
  items: OrderItem[];
}

export type OrderPatch = Partial<Pick<Order, 'status' | 'total_thb' | 'total_rub' | 'carrier' | 'tracking_number'>>;

export interface OrderEvent {
  id: number;
  order_id: string;
  status: OrderStatus | null;
  message: string | null;
  created_by: EventAuthor;
}

export interface Pricing {
  thb_rub: number;             // курс: сколько рублей за 1 бат
  commission_pct: number;
  commission_min_rub: number;
}

export interface CatalogVariant {
  id: string;
  color_code: string;
  color_name: string;
  size_label: string;
  price_thb: number;           // сатанги
  in_stock: boolean;
}
export interface CatalogProduct {
  source_id: string;
  name: string;                // name_ru ?? name_en
  url: string;
  variants: CatalogVariant[];
}

export interface Store {
  getClientByTelegram(telegramId: number): Promise<Client | null>;
  /** Создаёт клиента по telegram_id или обновляет переданные поля. */
  upsertTelegramClient(telegramId: number, patch: Partial<Omit<Client, 'id' | 'telegram_id'>>): Promise<Client>;
  getClient(id: string): Promise<Client | null>;

  createOrder(input: { client_id: string; source: OrderSource; items: NewOrderItem[]; comment?: string | null }): Promise<Order>;
  getOrder(id: string): Promise<Order | null>;
  updateOrder(id: string, patch: OrderPatch): Promise<Order>;
  updateItem(itemId: string, patch: { item_status?: ItemStatus; replacement_note?: string | null }): Promise<void>;
  listClientOrders(clientId: string, limit?: number): Promise<Order[]>;
  listActiveOrders(): Promise<Order[]>;

  addOrderPhoto(orderId: string, kind: PhotoKind, telegramFileId: string): Promise<void>;
  listOrderPhotos(orderId: string): Promise<{ kind: PhotoKind; telegram_file_id: string }[]>;

  addEvent(e: Omit<OrderEvent, 'id'>): Promise<void>;
  /** События с id больше курсора, по возрастанию. */
  listEventsAfter(cursor: number, limit?: number): Promise<OrderEvent[]>;

  getSetting<T>(key: string): Promise<T | null>;
  setSetting(key: string, value: unknown): Promise<void>;

  /** Бонусы (модуль loyalty, миграция 0005): привязать приглашение по коду. true — бонус подруге выдан. */
  registerReferral(clientId: string, code: string): Promise<boolean>;
  /** Неотправленные уведомления о бонусах (loyalty_notices.notified_at is null). */
  listLoyaltyNotices(limit?: number): Promise<{ id: number; client_id: string; text: string }[]>;
  markLoyaltyNoticeSent(id: number): Promise<void>;

  /** Товар из каталога по коду Uniqlo; null, если каталог ещё не выгружен или товара нет. */
  findProduct(sourceId: string): Promise<CatalogProduct | null>;
}

export const ACTIVE_STATUSES: OrderStatus[] = ['new', 'confirmed', 'paid', 'bought', 'shipped', 'in_russia'];
export const orderNo = (o: Pick<Order, 'number'>) => `A-${String(o.number).padStart(4, '0')}`;
