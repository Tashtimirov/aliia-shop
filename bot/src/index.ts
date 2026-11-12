import { createBot } from './bot.ts';
import { loadConfig } from './config.ts';
import { MemoryStore } from './store/memory.ts';
import { SupabaseStore } from './store/supabase.ts';
import type { Store } from './store/types.ts';

const config = loadConfig();
const store: Store = config.supabaseUrl && config.supabaseKey
  ? new SupabaseStore(config.supabaseUrl, config.supabaseKey)
  : new MemoryStore(config.dataFile);
console.log(store instanceof SupabaseStore ? 'Хранилище: Supabase' : `Хранилище: локальный файл ${config.dataFile}`);

// ИИ-напоминания (модуль src/lib/reminders в корне репозитория): кнопки «отложить» / «не напоминать» под сводкой.
let onReminderCallback: ((data: string) => Promise<string | null>) | undefined;
if (store instanceof SupabaseStore) {
  try {
    const path = process.env.REMINDERS_MODULE_DIR || '../../src/lib/reminders';
    const { handleReminderCallback } = await import(`${path}/service.ts`);
    const { supabaseReminderStore } = await import(`${path}/supabaseStore.ts`);
    const rs = supabaseReminderStore(store.db);
    onReminderCallback = data => handleReminderCallback(rs, data);
  } catch (err) {
    console.warn('Модуль напоминаний не найден, кнопки rem: отключены:', (err as Error).message);
  }
}

const { bot, processEvents, refreshAdmins } = createBot({ config, store, onReminderCallback });
await refreshAdmins();

await bot.api.setMyCommands([
  { command: 'start', description: 'Главное меню' },
  { command: 'help', description: 'Как заказать' },
  { command: 'cancel', description: 'Отменить текущее действие' },
]);
if (config.webAppUrl) {
  await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Каталог', web_app: { url: config.webAppUrl } } });
}

// Заказы с витрины и события других модулей (CRM, доставка, бонусы) приходят через order_events.
const timer = setInterval(processEvents, config.eventsPollMs);
const stop = () => { clearInterval(timer); bot.stop(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

await bot.start({ onStart: me => console.log(`Бот @${me.username} запущен`) });
