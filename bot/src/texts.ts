import type { Carrier, OrderStatus } from './store/types.ts';

export const BTN = {
  catalog: '🛍 Каталог',
  byLink: '🔗 Заказ по ссылке',
  cart: '🛒 Корзина',
  orders: '📦 Мои заказы',
  help: '❓ Как заказать',
  contact: '💬 Написать Алие',
  cancel: '✖️ Отмена',
  sendPhone: '📱 Отправить номер',
};

export const STATUS: Record<OrderStatus, string> = {
  new: '🆕 ждёт подтверждения',
  confirmed: '💳 ждёт оплаты',
  paid: '✅ оплачен, скоро выкуп',
  bought: '🛍 выкуплен',
  shipped: '🚚 в пути',
  in_russia: '🇷🇺 в России',
  delivered: '📬 доставлен',
  cancelled: '✖️ отменён',
};

export const CARRIER: Record<Carrier, string> = { cdek: 'СДЭК', light_logistic: 'Light Logistic' };

export function trackingUrl(carrier: Carrier, track: string): string | null {
  if (carrier === 'cdek') return `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(track)}`;
  return null; // у Light Logistic пока нет известной ссылки отслеживания
}

export const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

export const T = {
  welcome: (name: string, hasCatalog: boolean) =>
    `Привет, ${name}! 👋\n\nЯ бот <b>Aliia Buyer</b>. Через меня можно заказать вещи из официальных магазинов Uniqlo в Таиланде с доставкой в Россию.\n\n` +
    (hasCatalog ? '• <b>🛍 Каталог</b> — выбрать вещи с ценами в рублях\n' : '') +
    '• <b>🔗 Заказ по ссылке</b> — пришлите ссылку на товар с uniqlo.com/th, я спрошу цвет и размер\n' +
    '• <b>📦 Мои заказы</b> — статус, фото выкупа и трек-номер\n\nМожно просто прислать ссылку на товар прямо сюда.',
  help: (channel: string) =>
    '<b>Как заказать</b>\n\n' +
    '1. Найдите вещь на <a href="https://www.uniqlo.com/th/en/">uniqlo.com/th</a> и пришлите мне ссылку (или выберите в каталоге).\n' +
    '2. Выберите цвет и размер, добавьте в корзину и оформите заказ.\n' +
    '3. Алия проверит наличие и пришлёт сумму в рублях. Оплата переводом.\n' +
    '4. После выкупа пришлю фото вещи и этикетки.\n' +
    '5. При отправке пришлю трек-номер. Доставка до двери по России от 7 до 15 дней.\n\n' +
    `Новинки и наличие — в канале <a href="${channel}">Shop.Thailand</a>.`,
  askLink: 'Пришлите ссылку на товар с сайта uniqlo.com/th 👇',
  notUniqlo: 'Это не похоже на ссылку на товар Uniqlo. Нужна ссылка вида uniqlo.com/th/…/products/E465185-000',
  notThailand: 'ℹ️ Ссылка не с тайского сайта. Я приму её, но ассортимент и цены в Таиланде могут отличаться.',
  askColor: 'Какой цвет? Напишите, как на сайте (например, BLACK или 09 BLACK).',
  chooseColor: 'Выберите цвет:',
  chooseSize: 'Выберите размер:',
  typeSize: 'Напишите размер, как на сайте (например, 27 inch или 110):',
  askPrice: 'Сколько стоит на сайте, в батах? Так я сразу посчитаю сумму в рублях.',
  badPrice: 'Не понял цену. Напишите число в батах, например 1290.',
  added: (n: number) => `Добавила в корзину ✅ Сейчас в корзине: ${n}.`,
  cartEmpty: 'Корзина пуста. Пришлите ссылку на товар или откройте каталог.',
  askPhone: 'Оставьте номер телефона для связи и доставки: нажмите кнопку ниже или напишите номер.',
  askCity: 'В какой город доставить?',
  askComment: 'Напишите комментарий к заказу (например, «если нет M, возьмите L»):',
  orderSent: (no: string) =>
    `Заказ <b>${no}</b> отправлен Алие 🙌\nОна проверит наличие и пришлёт сумму к оплате. Статус всегда в «📦 Мои заказы».`,
  noOrders: 'Заказов пока нет.',
  askMessage: 'Напишите сообщение для Алии, я передам. Можно с фото.',
  messageSent: 'Передала Алие ✅ Ответ придёт сюда.',
  cancelled: 'Отменено.',
  unknown: 'Не поняла 🙈 Пришлите ссылку на товар Uniqlo или выберите действие в меню.',
};
