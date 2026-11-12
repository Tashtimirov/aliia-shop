import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBot } from '../src/bot.ts';
import type { Config } from '../src/config.ts';
import { MemoryStore } from '../src/store/memory.ts';
import { findUniqloLink } from '../src/uniqlo.ts';
import { itemPriceRub, orderPriceRub, parseThb, DEFAULT_PRICING } from '../src/pricing.ts';

const ALIIA = 100, CLIENT = 200;
const config: Config = {
  token: 'test', adminIds: [ALIIA], adminChatId: ALIIA, webAppUrl: null, paymentDetails: 'Оплата: тест',
  channelUrl: 'https://t.me/x', supabaseUrl: null, supabaseKey: null, dataFile: '', eventsPollMs: 0,
};

function setup() {
  const store = new MemoryStore();
  const { bot, processEvents } = createBot({ config, store }, {
    botInfo: { id: 1, is_bot: true, first_name: 'Bot', username: 'aliia_test_bot', can_join_groups: true,
      can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false,
      has_main_web_app: false } as any,
  });
  const calls: { method: string; payload: any }[] = [];
  let mid = 1000;
  bot.api.config.use(async (_prev, method, payload: any) => {
    calls.push({ method, payload });
    const result = method.startsWith('send') || method === 'copyMessage'
      ? { message_id: ++mid, date: 0, chat: { id: payload.chat_id, type: 'private' }, text: payload.text }
      : true;
    return { ok: true, result } as any;
  });
  let uid = 1;
  const from = (id: number) => ({ id, is_bot: false, first_name: id === ALIIA ? 'Алия' : 'Маша', username: id === ALIIA ? 'aliia' : 'masha' });
  const msg = (id: number, text: string, extra: any = {}) => bot.handleUpdate({ update_id: uid++,
    message: { message_id: uid, date: 0, chat: { id, type: 'private', first_name: 'x' }, from: from(id), text,
      ...(text?.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }] } : {}),
      ...extra } } as any);
  const photo = (id: number, fileId: string) => bot.handleUpdate({ update_id: uid++,
    message: { message_id: uid, date: 0, chat: { id, type: 'private', first_name: 'x' }, from: from(id),
      photo: [{ file_id: fileId, file_unique_id: fileId, width: 1, height: 1 }] } } as any);
  const cb = (id: number, data: string) => bot.handleUpdate({ update_id: uid++,
    callback_query: { id: String(uid), from: from(id), chat_instance: 'c', data,
      message: { message_id: 1, date: 0, chat: { id, type: 'private', first_name: 'x' }, text: 'card' } } } as any);
  const sentTo = (chat: number) => calls.filter(c => c.payload?.chat_id === chat && /^send|copy/.test(c.method));
  const lastText = (chat: number) => sentTo(chat).at(-1)?.payload.text as string;
  const buttons = (chat: number, back = 1) =>
    (sentTo(chat).filter(c => c.payload.reply_markup?.inline_keyboard).at(-back)?.payload.reply_markup.inline_keyboard ?? [])
      .flat().map((b: any) => b.callback_data ?? b.url);
  return { store, processEvents, calls, msg, photo, cb, sentTo, lastText, buttons };
}

const LINK = 'https://www.uniqlo.com/th/en/products/E465185-000/00?colorDisplayCode=09&sizeDisplayCode=003';

test('ссылки Uniqlo', () => {
  assert.deepEqual(findUniqloLink(`вот ${LINK} хочу`), { url: LINK, sourceId: 'E465185-000', colorCode: '09', isThailand: true });
  assert.equal(findUniqloLink('https://zara.com/x'), null);
  assert.equal(findUniqloLink('https://www.uniqlo.com/th/en/'), null);
});

test('цены', () => {
  assert.equal(parseThb('1,290'), 129000);
  assert.equal(parseThb('990 бат'), 99000);
  assert.equal(itemPriceRub(129000, DEFAULT_PRICING), 3860); // 1290×2.6=3354 + 15%=503.1 → 3857.1 → 3860
  assert.equal(orderPriceRub([{ price_thb: 0, qty: 1 }], DEFAULT_PRICING), null);
});

test('полный путь заказа по ссылке: клиент → Алия → выкуп с фото → отправка', async () => {
  const t = setup();
  await t.msg(CLIENT, '/start');
  assert.match(t.lastText(CLIENT), /Aliia Buyer/);

  // ссылка без каталога → цвет текстом → размер кнопкой → цена
  await t.msg(CLIENT, LINK);
  assert.match(t.lastText(CLIENT), /цвет/i);
  await t.msg(CLIENT, 'BLACK');
  assert.ok(t.buttons(CLIENT).includes('siz:M'));
  await t.cb(CLIENT, 'siz:M');
  assert.match(t.lastText(CLIENT), /батах/);
  await t.msg(CLIENT, '1290');
  assert.match(t.lastText(CLIENT), /Корзина[\s\S]*BLACK[\s\S]*M[\s\S]*3\s860 ₽/);

  // оформление: телефон, город, отправка
  await t.cb(CLIENT, 'cart:checkout');
  assert.match(t.lastText(CLIENT), /номер телефона/);
  await t.msg(CLIENT, '', { text: undefined, contact: { phone_number: '+79001234567', first_name: 'Маша' } });
  assert.match(t.lastText(CLIENT), /город/);
  await t.msg(CLIENT, 'Казань');
  assert.ok(t.buttons(CLIENT).includes('cart:send'));
  await t.cb(CLIENT, 'cart:send');
  assert.match(t.sentTo(CLIENT).at(-1)!.payload.text, /A-0001/);

  // карточка у Алии
  const card = t.sentTo(ALIIA).at(-1)!.payload;
  assert.match(card.text, /Новый заказ[\s\S]*A-0001[\s\S]*Маша[\s\S]*\+79001234567[\s\S]*Казань[\s\S]*E465185-000/);
  const order = (await t.store.listActiveOrders())[0];
  assert.ok(t.buttons(ALIIA).includes(`a:sum:${order.id}`));

  // клиент не может нажимать кнопки Алии
  await t.cb(CLIENT, `a:cancel:${order.id}`);
  assert.equal((await t.store.getOrder(order.id))!.status, 'new');

  // Алия подтверждает сумму числом
  await t.cb(ALIIA, `a:sum:${order.id}`);
  await t.msg(ALIIA, '4 500');
  assert.equal((await t.store.getOrder(order.id))!.total_rub, 4500);
  const conf = t.sentTo(CLIENT).at(-1)!.payload;
  assert.match(conf.text, /4\s500 ₽[\s\S]*Оплата: тест/);

  // клиент оплатил → Алии уведомление
  await t.cb(CLIENT, `c:paid:${order.id}`);
  assert.equal((await t.store.getOrder(order.id))!.status, 'paid');
  assert.match(t.lastText(ALIIA), /сообщил об оплате/);
  await t.photo(CLIENT, 'receipt1');
  assert.equal(t.sentTo(ALIIA).at(-1)!.method, 'sendPhoto');

  // выкуп: 2 фото вещи + 1 этикетка → клиенту альбом
  await t.cb(ALIIA, `a:bought:${order.id}`);
  await t.photo(ALIIA, 'item1');
  await t.photo(ALIIA, 'item2');
  await t.cb(ALIIA, `ap:label:${order.id}`);
  await t.photo(ALIIA, 'label1');
  await t.cb(ALIIA, `ap:done:${order.id}`);
  const album = t.sentTo(CLIENT).find(c => c.method === 'sendMediaGroup')!;
  assert.deepEqual(album.payload.media.map((m: any) => m.media), ['item1', 'item2', 'label1']);
  assert.match(album.payload.media[0].caption, /выкуплен/);
  assert.equal((await t.store.getOrder(order.id))!.items[0].item_status, 'bought');

  // отправка СДЭК
  await t.cb(ALIIA, `a:ship:${order.id}`);
  await t.cb(ALIIA, `at:cdek:${order.id}`);
  await t.msg(ALIIA, '1234567890');
  const ship = t.sentTo(CLIENT).at(-1)!.payload;
  assert.match(ship.text, /отправлен[\s\S]*СДЭК[\s\S]*1234567890/);
  assert.ok(t.buttons(CLIENT).some((u: string) => u?.includes('cdek.ru')));

  await t.cb(ALIIA, `a:done:${order.id}`);
  assert.equal((await t.store.getOrder(order.id))!.status, 'delivered');
  assert.match(t.lastText(CLIENT), /доставлен/);
});

test('каталог: цвета и размеры кнопками, цена из каталога', async () => {
  const t = setup();
  t.store.d.products.push({ source_id: 'E465185-000', name: 'Пуховик Ultra Light', url: LINK, variants: [
    { id: 'v1', color_code: '09', color_name: 'BLACK', size_label: 'S', price_thb: 199000, in_stock: true },
    { id: 'v2', color_code: '09', color_name: 'BLACK', size_label: 'M', price_thb: 199000, in_stock: false },
    { id: 'v3', color_code: '30', color_name: 'NATURAL', size_label: 'M', price_thb: 199000, in_stock: true },
  ] });
  await t.msg(CLIENT, LINK); // colorDisplayCode=09 в ссылке → сразу размеры чёрного
  assert.deepEqual(t.buttons(CLIENT), ['siz:v1', 'siz:v2']);
  await t.cb(CLIENT, 'siz:v2');
  assert.ok(t.sentTo(CLIENT).some(c => /нет онлайн|Онлайн этого размера нет/.test(c.payload.text ?? '')));
  assert.match(t.lastText(CLIENT), /Пуховик Ultra Light[\s\S]*09 BLACK[\s\S]*M/);
});

test('нет в наличии: замена и автоотмена, сообщения клиент ↔ Алия', async () => {
  const t = setup();
  await t.msg(CLIENT, '/start');
  await t.msg(CLIENT, LINK); await t.msg(CLIENT, 'WHITE'); await t.cb(CLIENT, 'siz:L'); await t.cb(CLIENT, 'price:skip');
  await t.store.upsertTelegramClient(CLIENT, { phone: '+7900', city: 'Москва' });
  await t.cb(CLIENT, 'cart:checkout'); await t.cb(CLIENT, 'cart:send');
  const o = (await t.store.listActiveOrders())[0];
  await t.cb(ALIIA, `a:unav:${o.id}`);
  await t.cb(ALIIA, `au:0:${o.id}`);
  await t.msg(ALIIA, 'Есть такой же в M');
  const texts = t.sentTo(CLIENT).map(c => c.payload.text ?? '');
  assert.ok(texts.some(s => /нет в наличии[\s\S]*Есть такой же в M/.test(s)));
  assert.ok(texts.some(s => /отменён[\s\S]*Все позиции закончились/.test(s)));
  assert.equal((await t.store.getOrder(o.id))!.status, 'cancelled');

  // сообщение клиента Алие и ответ
  await t.msg(CLIENT, '💬 Написать Алие');
  await t.msg(CLIENT, 'Беру M!');
  const head = t.sentTo(ALIIA).find(c => /#c200/.test(c.payload.text ?? ''))!;
  const headId = 1000 + t.calls.indexOf(head) + 1; // message_id, который вернул фейковый API
  await t.msg(ALIIA, 'Отлично, оформлю', { reply_to_message: { message_id: headId, date: 0, chat: { id: ALIIA, type: 'private' }, text: head.payload.text } });
  assert.ok(t.sentTo(CLIENT).some(c => c.method === 'copyMessage'));
});

test('заказ с витрины через order_events доходит до Алии', async () => {
  const t = setup();
  const c = await t.store.upsertTelegramClient(CLIENT, { name: 'Маша' });
  const o = await t.store.createOrder({ client_id: c.id, source: 'miniapp', items: [
    { sku: 'E1-000', url: null, name: 'Футболка', color: 'WHITE', size: 'S', qty: 2, price_thb: 39000 }] });
  await t.store.addEvent({ order_id: o.id, status: 'new', message: null, created_by: 'customer' });
  await t.processEvents();
  await t.processEvents(); // повторно не шлёт
  const cards = t.sentTo(ALIIA).filter(x => /Новый заказ/.test(x.payload.text));
  assert.equal(cards.length, 1);
  assert.match(cards[0].payload.text, /Футболка[\s\S]*2 шт/);
});

test('кнопки напоминаний rem: уходят в модуль напоминаний, только для админов', async () => {
  const store = new MemoryStore();
  const seen: string[] = [];
  const { bot } = createBot({ config, store, onReminderCallback: async d => { seen.push(d); return 'Отложено до завтра: тест'; } },
    { botInfo: { id: 1, is_bot: true, first_name: 'B', username: 'b' } as any });
  const answers: string[] = [];
  bot.api.config.use(async (_p, method, payload: any) => {
    if (method === 'answerCallbackQuery') answers.push(payload.text);
    return { ok: true, result: true } as any;
  });
  const cb = (id: number, data: string) => bot.handleUpdate({ update_id: 1, callback_query: { id: '1', chat_instance: 'c', data,
    from: { id, is_bot: false, first_name: 'x' }, message: { message_id: 1, date: 0, chat: { id, type: 'private' }, text: 's' } } } as any);
  await cb(CLIENT, 'rem:s:5');
  await cb(ALIIA, 'rem:s:5');
  assert.deepEqual(seen, ['rem:s:5']);
  assert.deepEqual(answers, ['Только для Алии', 'Отложено до завтра: тест']);
});

test('бонусы: приглашение по /start ref_ и доставка loyalty_notices', async () => {
  const t = setup();
  await t.msg(CLIENT, '/start ref_ALIIA7');
  assert.equal(t.store.d.referrals[0].code, 'ALIIA7');
  assert.ok(t.sentTo(CLIENT).some(c => /приглашению/.test(c.payload.text ?? '')));
  const c = (await t.store.getClientByTelegram(CLIENT))!;
  t.store.d.notices.push({ id: 1, client_id: c.id, text: 'Начислено 300 ₽ приветственных бонусов', notified_at: null });
  await t.processEvents();
  await t.processEvents();
  assert.equal(t.sentTo(CLIENT).filter(x => /300 ₽ приветственных/.test(x.payload.text ?? '')).length, 1);
  assert.ok(t.store.d.notices[0].notified_at);
});
