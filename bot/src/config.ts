import 'dotenv/config';

function list(v: string | undefined): number[] {
  return (v ?? '').split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n !== 0);
}

export interface Config {
  token: string;
  /** Telegram id Алии и Ильдара: им доступны кнопки управления заказами */
  adminIds: number[];
  /** Куда слать карточки новых заказов: личка Алии или закрытая группа */
  adminChatId: number;
  /** Ссылка на Mini App / сайт (кнопка «Каталог»). Пусто — кнопки нет, работает заказ по ссылке */
  webAppUrl: string | null;
  /** Как платить: показывается клиенту после подтверждения суммы */
  paymentDetails: string;
  channelUrl: string;
  supabaseUrl: string | null;
  supabaseKey: string | null;
  dataFile: string;
  eventsPollMs: number;
}

export function loadConfig(env = process.env): Config {
  const token = env.TELEGRAM_BOT_TOKEN || env.BOT_TOKEN;
  if (!token) throw new Error('Нет TELEGRAM_BOT_TOKEN в .env');
  const adminIds = list(env.ADMIN_IDS);
  if (!adminIds.length) throw new Error('Нет ADMIN_IDS в .env (telegram id Алии через запятую)');
  return {
    token,
    adminIds,
    adminChatId: Number(env.ADMIN_CHAT_ID || adminIds[0]),
    webAppUrl: env.WEBAPP_URL || null,
    paymentDetails: env.PAYMENT_DETAILS || 'Реквизиты для оплаты пришлёт Алия.',
    channelUrl: env.CHANNEL_URL || 'https://t.me/fromthailand_rus',
    supabaseUrl: env.SUPABASE_URL || null,
    supabaseKey: env.SUPABASE_SERVICE_ROLE_KEY || null,
    dataFile: env.DATA_FILE || 'data.json',
    eventsPollMs: Number(env.EVENTS_POLL_MS || 10_000),
  };
}
