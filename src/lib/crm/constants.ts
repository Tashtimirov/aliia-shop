// Общие для сервера и браузера константы CRM.

export type OrderStatus = 'new' | 'confirmed' | 'paid' | 'bought' | 'shipped' | 'in_russia' | 'delivered' | 'cancelled';

export const STATUS_LABEL: Record<OrderStatus, string> = {
  new: 'Новый',
  confirmed: 'Подтверждён',
  paid: 'Оплачен',
  bought: 'Выкуплен',
  shipped: 'Отправлен',
  in_russia: 'В России',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
};
export const STATUSES = Object.keys(STATUS_LABEL) as OrderStatus[];

/** Статусы, которые Алия ставит руками. shipped, in_russia и delivered выставляет модуль доставки по треку. */
export const MANUAL_STATUSES: OrderStatus[] = ['new', 'confirmed', 'paid', 'bought', 'cancelled'];

/** Заказы «в работе» для фильтра по умолчанию. */
export const ACTIVE_STATUSES: OrderStatus[] = ['new', 'confirmed', 'paid', 'bought', 'shipped', 'in_russia'];

export const STATUS_TONE: Record<OrderStatus, string> = {
  new: 'bg-neutral-200 text-neutral-800 dark:bg-neutral-700 dark:text-neutral-100',
  confirmed: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  paid: 'bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200',
  bought: 'bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200',
  shipped: 'bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200',
  in_russia: 'bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-200',
  delivered: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200',
  cancelled: 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200',
};

export const ITEM_STATUS_LABEL: Record<string, string> = {
  pending: 'Ждёт выкупа',
  bought: 'Выкуплено',
  unavailable: 'Нет в наличии',
  replaced: 'Замена',
};

export const PHOTO_KINDS = { label: 'Этикетка', item: 'Товар', receipt: 'Чек', package: 'Упаковка' } as const;
export type PhotoKind = keyof typeof PHOTO_KINDS;

export const CARRIER_LABEL: Record<string, string> = { light_logistic: 'Light Logistic', cdek: 'СДЭК' };

export const SIZE_FIELDS: [string, string][] = [
  ['top', 'Верх'], ['bottom', 'Низ / джинсы'], ['shoes', 'Обувь'], ['height', 'Рост, см'],
  ['chest', 'Грудь, см'], ['waist', 'Талия, см'], ['hips', 'Бёдра, см'],
];

export const CLIENT_SOURCES: Record<string, string> = { manual: 'Вручную', instagram: 'Instagram', telegram: 'Telegram', site: 'Сайт' };

export const orderLabel = (n: number) => `A-${String(n).padStart(4, '0')}`;
