import { Bot, type BotConfig, InlineKeyboard, Keyboard, session, type Context, type SessionFlavor } from 'grammy';
import type { Config } from './config.ts';
import { DEFAULT_PRICING, fmtRub, fmtThb, orderPriceRub, parseRub, parseThb } from './pricing.ts';
import type {
  Carrier, CatalogProduct, Client, NewOrderItem, Order, OrderEvent, OrderStatus, PhotoKind, Pricing, Store,
} from './store/types.ts';
import { orderNo } from './store/types.ts';
import { BTN, CARRIER, SIZES, STATUS, T, trackingUrl } from './texts.ts';
import { findUniqloLink } from './uniqlo.ts';

// ---------- состояние диалога ----------

type Draft = Partial<NewOrderItem> & { product?: CatalogProduct | null };
type Step =
  | { k: 'idle' }
  | { k: 'link' }
  | { k: 'color' }
  | { k: 'size' }
  | { k: 'size_text' }
  | { k: 'price' }
  | { k: 'phone' }
  | { k: 'city' }
  | { k: 'comment' }
  | { k: 'message' }
  | { k: 'receipt'; orderId: string }
  // шаги Алии
  | { k: 'adm_sum'; orderId: string }
  | { k: 'adm_photos'; orderId: string; kind: PhotoKind; count: number }
  | { k: 'adm_unavail'; orderId: string; idx: number }
  | { k: 'adm_track'; orderId: string; carrier: Carrier };

interface Session { step: Step; cart: NewOrderItem[]; draft: Draft; comment: string | null }
export type Ctx = Context & SessionFlavor<Session>;

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const HTML = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true } };

// ---------- форматирование ----------

function itemLine(it: NewOrderItem, i: number): string {
  const name = it.url ? `<a href="${esc(it.url)}">${esc(it.name || 'Товар Uniqlo')}</a>` : esc(it.name || 'Товар Uniqlo');
  const parts = [it.color && `цвет ${esc(it.color)}`, it.size && `размер ${esc(it.size)}`, it.qty > 1 && `${it.qty} шт.`,
    it.price_thb ? fmtThb(it.price_thb * it.qty) : null].filter(Boolean);
  const st = 'item_status' in it && it.item_status === 'unavailable' ? ' — <s>нет в наличии</s>' : '';
  return `${i + 1}. ${name}${it.sku ? ` <code>${esc(it.sku)}</code>` : ''}\n   ${parts.join(', ')}${st}`;
}

function clientLine(c: Client | null): string {
  if (!c) return 'клиент не найден';
  return [esc(c.name) || 'Без имени', c.telegram_username && `@${esc(c.telegram_username)}`,
    c.phone && esc(c.phone), c.city && esc(c.city)].filter(Boolean).join(' · ');
}

export function adminCard(o: Order, c: Client | null, pricing: Pricing): string {
  const est = orderPriceRub(o.items.filter(i => i.item_status !== 'unavailable'), pricing);
  const lines = [
    `<b>Заказ ${orderNo(o)}</b> · ${STATUS[o.status]}`,
    `👤 ${clientLine(c)}`,
    `Источник: ${o.source === 'bot_link' ? 'бот, по ссылке' : o.source}`,
    '',
    ...o.items.map(itemLine),
    '',
  ];
  if (o.total_rub) lines.push(`Сумма клиенту: <b>${fmtRub(o.total_rub)}</b>`);
  else if (est) lines.push(`Расчёт без доставки: ~${fmtRub(est)}`);
  if (o.tracking_number && o.carrier) lines.push(`Трек ${CARRIER[o.carrier]}: <code>${esc(o.tracking_number)}</code>`);
  if (o.comment) lines.push(`💬 ${esc(o.comment)}`);
  return lines.join('\n');
}

export function adminButtons(o: Order): InlineKeyboard {
  const kb = new InlineKeyboard();
  const a = (label: string, action: string) => kb.text(label, `a:${action}:${o.id}`);
  switch (o.status) {
    case 'new': a('💰 Подтвердить сумму', 'sum').row(); break;
    case 'confirmed': a('✅ Оплата получена', 'paid').row(); break;
  }
  if (['new', 'confirmed', 'paid'].includes(o.status)) {
    a('🛍 Выкуплено', 'bought'); a('❌ Нет в наличии', 'unav').row();
  }
  if (o.status === 'bought') a('🚚 Отправлено', 'ship').row();
  if (o.status === 'shipped') { a('🇷🇺 Пришло в Россию', 'ru'); a('📬 Доставлено', 'done').row(); }
  if (o.status === 'in_russia') a('📬 Доставлено', 'done').row();
  if (['new', 'confirmed', 'paid'].includes(o.status)) a('✖️ Отменить заказ', 'cancel');
  return kb;
}

function clientOrderText(o: Order): string {
  const lines = [`<b>${orderNo(o)}</b> · ${STATUS[o.status]}`, ...o.items.map(itemLine)];
  if (o.total_rub) lines.push(`Сумма: <b>${fmtRub(o.total_rub)}</b>`);
  if (o.tracking_number && o.carrier) {
    const url = trackingUrl(o.carrier, o.tracking_number);
    lines.push(`Трек ${CARRIER[o.carrier]}: ${url ? `<a href="${url}">${esc(o.tracking_number)}</a>` : `<code>${esc(o.tracking_number)}</code>`}`);
  }
  return lines.join('\n');
}

// ---------- бот ----------

export interface BotDeps {
  config: Config;
  store: Store;
  /** Кнопки под сводкой ИИ-напоминаний (callback_data 'rem:…', модуль reminders). Вернуть текст ответа или null. */
  onReminderCallback?: (data: string) => Promise<string | null>;
}

export function createBot({ config, store, onReminderCallback }: BotDeps, botOptions?: BotConfig<Ctx>) {
  const bot = new Bot<Ctx>(config.token, botOptions);
  /** Админы: ADMIN_IDS из .env плюс settings.admins из базы (общий список с модулем напоминаний). */
  let dbAdmins: number[] = [];
  const refreshAdmins = async () => {
    const a = await store.getSetting<unknown>('admins');
    dbAdmins = Array.isArray(a) ? a.map(Number).filter(Number.isInteger) : [];
  };
  const isAdmin = (ctx: Context) => !!ctx.from && (config.adminIds.includes(ctx.from.id) || dbAdmins.includes(ctx.from.id));
  const pricing = async () => (await store.getSetting<Pricing>('pricing')) ?? DEFAULT_PRICING;
  /** Сообщения «клиент → Алия»: id сообщения в админ-чате → telegram id клиента */
  const relay = new Map<number, number>();

  bot.use(session({
    initial: (): Session => ({ step: { k: 'idle' }, cart: [], draft: {}, comment: null }),
    getSessionKey: ctx => ctx.from?.id.toString(),
  }));

  const mainMenu = () => {
    const kb = new Keyboard();
    if (config.webAppUrl) kb.webApp(BTN.catalog, config.webAppUrl);
    kb.text(BTN.byLink).row().text(BTN.cart).text(BTN.orders).row().text(BTN.help).text(BTN.contact);
    return { reply_markup: kb.resized().persistent() };
  };
  const cancelMenu = { reply_markup: new Keyboard().text(BTN.cancel).resized() };

  const ensureClient = (ctx: Context) => store.upsertTelegramClient(ctx.from!.id, {
    telegram_username: ctx.from!.username ?? null,
    name: [ctx.from!.first_name, ctx.from!.last_name].filter(Boolean).join(' ') || null,
  });

  // ---------- события заказов → уведомления ----------

  let queue = Promise.resolve();
  /** Разбирает новые order_events и шлёт уведомления. Безопасно вызывать часто: вызовы идут по очереди. */
  const processEvents = () => (queue = queue.then(async () => {
    await refreshAdmins();
    let cursor = (await store.getSetting<number>('bot_events_cursor')) ?? 0;
    for (const e of await store.listEventsAfter(cursor)) {
      try { await notify(e); } catch (err) { console.error(`Уведомление по событию ${e.id} не отправлено:`, err); }
      cursor = e.id;
      await store.setSetting('bot_events_cursor', cursor);
    }
    await sendLoyaltyNotices();
  }).catch(err => console.error('Ошибка обработки событий:', err)));

  /** Уведомления бонусной программы: тексты готовит база, бот только доставляет. */
  let loyaltyWarned = false;
  async function sendLoyaltyNotices() {
    let notices: Awaited<ReturnType<Store['listLoyaltyNotices']>>;
    try { notices = await store.listLoyaltyNotices(); } catch (err) {
      if (!loyaltyWarned) console.warn('Бонусы недоступны (нет миграции loyalty?):', (err as Error).message);
      loyaltyWarned = true;
      return;
    }
    for (const n of notices) {
      const c = await store.getClient(n.client_id);
      try {
        if (c?.telegram_id) await bot.api.sendMessage(c.telegram_id, `🎁 ${esc(n.text)}`, HTML);
      } catch (err) { console.error(`Бонусное уведомление ${n.id} не отправлено:`, err); }
      await store.markLoyaltyNoticeSent(n.id);
    }
  }

  async function sendAdminCard(o: Order, header?: string) {
    const c = await store.getClient(o.client_id);
    await bot.api.sendMessage(config.adminChatId, (header ? `${header}\n\n` : '') + adminCard(o, c, await pricing()),
      { ...HTML, reply_markup: adminButtons(o) });
  }

  async function notify(e: OrderEvent) {
    const o = await store.getOrder(e.order_id);
    if (!o) return;
    const c = await store.getClient(o.client_id);
    const tid = c?.telegram_id;
    const toClient = (text: string, extra: object = {}) => tid ? bot.api.sendMessage(tid, text, { ...HTML, ...extra }) : undefined;
    const no = orderNo(o);

    if (e.status === null) { // событие без смены статуса: замена позиции, бонусы и т.п.
      if (e.message && e.created_by !== 'customer') await toClient(`По заказу <b>${no}</b>:\n${esc(e.message)}`);
      return;
    }
    switch (e.status) {
      case 'new':
        if (e.created_by !== 'admin') await sendAdminCard(o, '🆕 Новый заказ');
        break;
      case 'confirmed':
        await toClient(
          `Заказ <b>${no}</b> подтверждён 🙌\nСумма к оплате: <b>${o.total_rub ? fmtRub(o.total_rub) : 'уточнит Алия'}</b>` +
          ` (доставка по весу оплачивается отдельно при получении).\n\n${esc(config.paymentDetails)}\n\nПосле оплаты нажмите кнопку ниже.`,
          { reply_markup: new InlineKeyboard().text('💳 Я оплатил(а)', `c:paid:${o.id}`) });
        break;
      case 'paid':
        if (e.created_by === 'customer') await sendAdminCard(o, `💳 Клиент сообщил об оплате ${no}. Проверьте поступление.`);
        else await toClient(`Оплата по заказу <b>${no}</b> получена ✅ Скоро выкупим!`);
        break;
      case 'bought': {
        const photos = await store.listOrderPhotos(o.id);
        const caption = `Заказ <b>${no}</b> выкуплен 🛍` + (photos.length ? '\nФото вещи и этикетки 👇' : '') +
          '\nКак только отправим, пришлю трек-номер.';
        if (!tid) break;
        if (photos.length) {
          for (let i = 0; i < photos.length; i += 10) {
            await bot.api.sendMediaGroup(tid, photos.slice(i, i + 10).map((p, j) => ({
              type: 'photo' as const, media: p.telegram_file_id,
              ...(i === 0 && j === 0 ? { caption, parse_mode: 'HTML' as const } : {}),
            })));
          }
        } else await toClient(caption);
        break;
      }
      case 'shipped': {
        const url = o.carrier && o.tracking_number ? trackingUrl(o.carrier, o.tracking_number) : null;
        await toClient(`Заказ <b>${no}</b> отправлен 🚚\n` +
          (o.carrier ? `Перевозчик: ${CARRIER[o.carrier]}\n` : '') +
          (o.tracking_number ? `Трек-номер: <code>${esc(o.tracking_number)}</code>` : ''),
          url ? { reply_markup: new InlineKeyboard().url('Отследить посылку', url) } : {});
        break;
      }
      case 'in_russia':
        await toClient(`Заказ <b>${no}</b> уже в России 🇷🇺 Скоро будет у вас.`);
        break;
      case 'delivered':
        await toClient(`Заказ <b>${no}</b> доставлен 📬 Спасибо, что заказываете у Алии!\n` +
          `Будем рады отзыву и фото в обновке, просто пришлите сюда через «${BTN.contact}» 💛`);
        break;
      case 'cancelled':
        if (e.created_by === 'customer') await sendAdminCard(o, `✖️ Клиент отменил заказ ${no}`);
        else await toClient(`Заказ <b>${no}</b> отменён.` + (e.message ? `\n${esc(e.message)}` : ''));
        break;
    }
  }

  async function setStatus(orderId: string, status: OrderStatus, by: OrderEvent['created_by'], message: string | null = null) {
    const o = await store.updateOrder(orderId, { status });
    await store.addEvent({ order_id: orderId, status, message, created_by: by });
    await processEvents();
    return o;
  }

  // ---------- /start и меню ----------

  bot.command('start', async ctx => {
    ctx.session.step = { k: 'idle' };
    const client = await ensureClient(ctx);
    // Ссылка-приглашение t.me/<бот>?start=ref_КОД: бонус подруге выдаёт база (loyalty_register_referral).
    const ref = /^ref_([A-Za-z0-9-]{3,32})$/.exec(ctx.match ?? '');
    if (ref) {
      try {
        if (await store.registerReferral(client.id, ref[1])) await ctx.reply('🎁 Вы пришли по приглашению, бонус на первый заказ уже ждёт вас!');
      } catch (err) { console.error('Не удалось привязать приглашение:', err); }
    }
    await ctx.reply(T.welcome(esc(ctx.from!.first_name), !!config.webAppUrl), { ...HTML, ...mainMenu() });
  });
  bot.command('id', ctx => ctx.reply(`Ваш Telegram id: <code>${ctx.from!.id}</code>\nЭтот чат: <code>${ctx.chat.id}</code>`, HTML));
  bot.command('help', ctx => ctx.reply(T.help(config.channelUrl), { ...HTML, ...mainMenu() }));
  bot.hears(BTN.help, ctx => ctx.reply(T.help(config.channelUrl), { ...HTML, ...mainMenu() }));

  bot.command('cancel', async ctx => { ctx.session.step = { k: 'idle' }; await ctx.reply(T.cancelled, mainMenu()); });
  bot.hears(BTN.cancel, async ctx => { ctx.session.step = { k: 'idle' }; ctx.session.draft = {}; await ctx.reply(T.cancelled, mainMenu()); });

  bot.hears(BTN.byLink, async ctx => { ctx.session.step = { k: 'link' }; await ctx.reply(T.askLink, cancelMenu); });

  bot.hears(BTN.contact, async ctx => { ctx.session.step = { k: 'message' }; await ctx.reply(T.askMessage, cancelMenu); });

  bot.hears(BTN.orders, async ctx => {
    ctx.session.step = { k: 'idle' };
    const c = await ensureClient(ctx);
    const orders = await store.listClientOrders(c.id, 5);
    if (!orders.length) return ctx.reply(T.noOrders, mainMenu());
    for (const o of orders) {
      const kb = new InlineKeyboard();
      if (o.status === 'confirmed') kb.text('💳 Я оплатил(а)', `c:paid:${o.id}`);
      if (o.status === 'new') kb.text('✖️ Отменить', `c:cancel:${o.id}`);
      await ctx.reply(clientOrderText(o), { ...HTML, reply_markup: kb });
    }
  });

  // ---------- корзина и оформление ----------

  async function showCart(ctx: Ctx) {
    const cart = ctx.session.cart;
    if (!cart.length) return ctx.reply(T.cartEmpty, mainMenu());
    const est = orderPriceRub(cart, await pricing());
    await ctx.reply(`<b>Корзина</b>\n\n${cart.map(itemLine).join('\n')}` +
      (est ? `\n\nПримерно <b>${fmtRub(est)}</b> без доставки. Точную сумму подтвердит Алия.` : ''),
      { ...HTML, reply_markup: new InlineKeyboard().text('✅ Оформить заказ', 'cart:checkout').row()
        .text('➕ Ещё вещь', 'cart:more').text('🗑 Очистить', 'cart:clear') });
  }
  bot.hears(BTN.cart, async ctx => { ctx.session.step = { k: 'idle' }; await showCart(ctx); });

  bot.callbackQuery('cart:more', async ctx => {
    await ctx.answerCallbackQuery();
    ctx.session.step = { k: 'link' };
    await ctx.reply(T.askLink, cancelMenu);
  });
  bot.callbackQuery('cart:clear', async ctx => {
    ctx.session.cart = [];
    await ctx.answerCallbackQuery('Корзина очищена');
    await ctx.editMessageText(T.cartEmpty);
  });
  bot.callbackQuery('cart:checkout', async ctx => { await ctx.answerCallbackQuery(); await checkout(ctx); });
  bot.callbackQuery('cart:comment', async ctx => {
    await ctx.answerCallbackQuery();
    ctx.session.step = { k: 'comment' };
    await ctx.reply(T.askComment, cancelMenu);
  });
  bot.callbackQuery('cart:send', async ctx => {
    await ctx.answerCallbackQuery();
    if (!ctx.session.cart.length) return ctx.reply(T.cartEmpty, mainMenu());
    const c = await ensureClient(ctx);
    const o = await store.createOrder({ client_id: c.id, source: 'bot_link', items: ctx.session.cart, comment: ctx.session.comment });
    ctx.session.cart = []; ctx.session.comment = null; ctx.session.step = { k: 'idle' };
    await ctx.editMessageReplyMarkup();
    await ctx.reply(T.orderSent(orderNo(o)), { ...HTML, ...mainMenu() });
    await store.addEvent({ order_id: o.id, status: 'new', message: null, created_by: 'customer' });
    await processEvents();
  });

  /** Доспрашивает телефон и город, потом показывает итог с кнопкой отправки. */
  async function checkout(ctx: Ctx) {
    if (!ctx.session.cart.length) return ctx.reply(T.cartEmpty, mainMenu());
    const c = await ensureClient(ctx);
    if (!c.phone) {
      ctx.session.step = { k: 'phone' };
      return ctx.reply(T.askPhone, { reply_markup: new Keyboard().requestContact(BTN.sendPhone).row().text(BTN.cancel).resized() });
    }
    if (!c.city) { ctx.session.step = { k: 'city' }; return ctx.reply(T.askCity, cancelMenu); }
    ctx.session.step = { k: 'idle' };
    const est = orderPriceRub(ctx.session.cart, await pricing());
    await ctx.reply(`<b>Проверьте заказ</b>\n\n${ctx.session.cart.map(itemLine).join('\n')}\n\n` +
      `📱 ${esc(c.phone)} · 📍 ${esc(c.city)}` +
      (ctx.session.comment ? `\n💬 ${esc(ctx.session.comment)}` : '') +
      (est ? `\n\nПримерно <b>${fmtRub(est)}</b> без доставки.` : '') +
      '\nВыкуп при наличии в магазине. Точную сумму пришлёт Алия.',
      { ...HTML, reply_markup: new InlineKeyboard().text('🚀 Отправить заказ', 'cart:send').row()
        .text('💬 Комментарий', 'cart:comment').text('➕ Ещё вещь', 'cart:more') });
    await ctx.reply('Меню 👇', mainMenu());
  }

  bot.on('message:contact', async ctx => {
    if (ctx.session.step.k !== 'phone') return;
    await store.upsertTelegramClient(ctx.from.id, { phone: ctx.message.contact.phone_number });
    await checkout(ctx);
  });

  // ---------- выбор товара ----------

  async function startItem(ctx: Ctx, text: string) {
    const link = findUniqloLink(text);
    if (!link) { ctx.session.step = { k: 'link' }; return ctx.reply(T.notUniqlo, cancelMenu); }
    if (!link.isThailand) await ctx.reply(T.notThailand);
    const product = await store.findProduct(link.sourceId);
    ctx.session.draft = { sku: link.sourceId, url: link.url, name: product?.name ?? null, qty: 1, product };
    if (product?.variants.length) {
      const colors = [...new Map(product.variants.map(v => [v.color_code, v.color_name])).entries()];
      const pre = colors.find(([code]) => code === link.colorCode);
      if (colors.length === 1 || pre) return pickColor(ctx, (pre ?? colors[0])[0]);
      ctx.session.step = { k: 'color' };
      const kb = new InlineKeyboard();
      colors.forEach(([code, name], i) => { kb.text(`${code} ${name}`, `col:${code}`); if (i % 2) kb.row(); });
      return ctx.reply(`<b>${esc(product.name)}</b>\n${T.chooseColor}`, { ...HTML, reply_markup: kb });
    }
    ctx.session.step = { k: 'color' };
    await ctx.reply(T.askColor, cancelMenu);
  }

  async function pickColor(ctx: Ctx, code: string) {
    const d = ctx.session.draft;
    const vs = d.product?.variants.filter(v => v.color_code === code) ?? [];
    d.color = vs.length ? `${code} ${vs[0].color_name}` : code;
    ctx.session.step = { k: 'size' };
    const kb = new InlineKeyboard();
    if (vs.length) {
      vs.forEach((v, i) => {
        kb.text(`${v.size_label}${v.in_stock ? '' : ' (нет онлайн)'} · ${fmtThb(v.price_thb)}`, `siz:${v.id}`);
        if (i % 2) kb.row();
      });
    } else {
      SIZES.forEach((s, i) => { kb.text(s, `siz:${s}`); if (i % 4 === 3) kb.row(); });
      kb.row().text('Другой размер', 'siz:_other');
    }
    await ctx.reply(`Цвет: ${esc(d.color)}\n${T.chooseSize}`, { ...HTML, reply_markup: kb });
  }

  bot.callbackQuery(/^col:(.+)$/, async ctx => {
    await ctx.answerCallbackQuery();
    if (ctx.session.step.k !== 'color') return;
    await pickColor(ctx, ctx.match[1]);
  });

  bot.callbackQuery(/^siz:(.+)$/, async ctx => {
    await ctx.answerCallbackQuery();
    if (ctx.session.step.k !== 'size') return;
    const d = ctx.session.draft, val = ctx.match[1];
    if (val === '_other') { ctx.session.step = { k: 'size_text' }; return ctx.reply(T.typeSize, cancelMenu); }
    const v = d.product?.variants.find(v => v.id === val);
    if (v) {
      d.size = v.size_label; d.price_thb = v.price_thb; d.variant_id = v.id;
      if (!v.in_stock) await ctx.reply('ℹ️ Онлайн этого размера нет, но Алия проверит в магазине.');
      return addDraft(ctx);
    }
    d.size = val;
    return askPrice(ctx);
  });

  async function askPrice(ctx: Ctx) {
    if (ctx.session.draft.price_thb) return addDraft(ctx);
    ctx.session.step = { k: 'price' };
    await ctx.reply(T.askPrice, { reply_markup: new InlineKeyboard().text('Не знаю, пусть посчитает Алия', 'price:skip') });
  }
  bot.callbackQuery('price:skip', async ctx => {
    await ctx.answerCallbackQuery();
    if (ctx.session.step.k !== 'price') return;
    ctx.session.draft.price_thb = 0;
    await addDraft(ctx);
  });

  async function addDraft(ctx: Ctx) {
    const { product: _p, ...d } = ctx.session.draft;
    ctx.session.cart.push({
      variant_id: d.variant_id ?? null, sku: d.sku ?? null, url: d.url ?? null, name: d.name ?? null,
      color: d.color ?? null, size: d.size ?? null, qty: d.qty ?? 1, price_thb: d.price_thb ?? 0,
    });
    ctx.session.draft = {}; ctx.session.step = { k: 'idle' };
    await ctx.reply(T.added(ctx.session.cart.length), mainMenu());
    await showCart(ctx);
  }

  // ---------- кнопки клиента по заказу ----------

  async function ownOrder(ctx: Ctx, id: string) {
    const [o, c] = await Promise.all([store.getOrder(id), store.getClientByTelegram(ctx.from!.id)]);
    return o && c && o.client_id === c.id ? o : null;
  }
  bot.callbackQuery(/^c:paid:(.+)$/, async ctx => {
    const o = await ownOrder(ctx, ctx.match[1]);
    if (!o || o.status !== 'confirmed') return ctx.answerCallbackQuery('Этот заказ сейчас не ждёт оплаты');
    await ctx.answerCallbackQuery('Спасибо!');
    await ctx.editMessageReplyMarkup();
    ctx.session.step = { k: 'receipt', orderId: o.id };
    await ctx.reply('Спасибо! Передала Алие. Если есть чек или скриншот перевода, пришлите его сюда.', cancelMenu);
    await setStatus(o.id, 'paid', 'customer');
  });
  bot.callbackQuery(/^c:cancel:(.+)$/, async ctx => {
    const o = await ownOrder(ctx, ctx.match[1]);
    if (!o || o.status !== 'new') return ctx.answerCallbackQuery('Этот заказ уже нельзя отменить здесь, напишите Алие');
    await ctx.answerCallbackQuery('Заказ отменён');
    await ctx.editMessageReplyMarkup();
    await setStatus(o.id, 'cancelled', 'customer');
    await ctx.reply(`Заказ ${orderNo(o)} отменён.`, mainMenu());
  });

  // ---------- заказ из Mini App через sendData ----------
  // Основной путь: витрина сама пишет заказ в базу и событие 'new' в order_events. Это запасной путь.
  bot.on('message:web_app_data', async ctx => {
    let data: { items?: NewOrderItem[]; comment?: string };
    try { data = JSON.parse(ctx.message.web_app_data.data); } catch { return ctx.reply('Не удалось прочитать заказ из каталога.'); }
    const items = (data.items ?? []).filter(i => i && (i.sku || i.url)).map(i => ({
      variant_id: i.variant_id ?? null, sku: i.sku ?? null, url: i.url ?? null, name: i.name ?? null,
      color: i.color ?? null, size: i.size ?? null, qty: Math.max(1, Number(i.qty) || 1), price_thb: Number(i.price_thb) || 0,
    }));
    if (!items.length) return ctx.reply(T.cartEmpty, mainMenu());
    ctx.session.cart.push(...items);
    if (data.comment) ctx.session.comment = data.comment;
    await checkout(ctx);
  });

  // ---------- кнопки Алии ----------

  // Префикс 'rem:' занят модулем ИИ-напоминаний.
  bot.callbackQuery(/^rem:/, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Только для Алии');
    const answer = onReminderCallback ? await onReminderCallback(ctx.callbackQuery.data) : null;
    await ctx.answerCallbackQuery(answer ?? 'Напоминания сейчас не подключены');
    if (answer) await ctx.editMessageReplyMarkup().catch(() => {});
  });

  bot.callbackQuery(/^a:(\w+):(.+)$/, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Только для Алии');
    const [, action, id] = ctx.match;
    const o = await store.getOrder(id);
    if (!o) return ctx.answerCallbackQuery('Заказ не найден');
    await ctx.answerCallbackQuery();
    const no = orderNo(o);
    const refresh = async (u: Order) => {
      try {
        await ctx.editMessageText(adminCard(u, await store.getClient(u.client_id), await pricing()),
          { ...HTML, reply_markup: adminButtons(u) });
      } catch { /* карточка не изменилась или слишком старая */ }
    };

    switch (action) {
      case 'sum': {
        ctx.session.step = { k: 'adm_sum', orderId: o.id };
        const est = orderPriceRub(o.items.filter(i => i.item_status !== 'unavailable'), await pricing());
        const kb = est ? new InlineKeyboard().text(`Принять ${fmtRub(est)}`, `as:${est}:${o.id}`) : undefined;
        return ctx.reply(`Сумма для ${no} в рублях (без доставки)? Напишите число` + (est ? ' или примите расчёт.' : '.'),
          { reply_markup: kb });
      }
      case 'paid': return refresh(await setStatus(o.id, 'paid', 'admin'));
      case 'bought':
        ctx.session.step = { k: 'adm_photos', orderId: o.id, kind: 'item', count: 0 };
        return ctx.reply(`📸 ${no}: пришлите фото вещи (можно несколько), потом нажмите «Дальше».`,
          { reply_markup: new InlineKeyboard().text('Дальше: этикетка ➡️', `ap:label:${o.id}`).row().text('Без фото', `ap:done:${o.id}`) });
      case 'unav': {
        const kb = new InlineKeyboard();
        o.items.forEach((it, i) => {
          if (it.item_status !== 'unavailable') kb.text(`${i + 1}. ${(it.name || it.sku || 'Товар').slice(0, 20)} ${it.size ?? ''}`, `au:${i}:${o.id}`).row();
        });
        return ctx.reply(`Какой позиции нет в ${no}?`, { reply_markup: kb });
      }
      case 'ship':
        return ctx.reply(`Чем отправили ${no}?`, { reply_markup: new InlineKeyboard()
          .text('СДЭК', `at:cdek:${o.id}`).text('Light Logistic', `at:light_logistic:${o.id}`) });
      case 'ru': return refresh(await setStatus(o.id, 'in_russia', 'admin'));
      case 'done': return refresh(await setStatus(o.id, 'delivered', 'admin'));
      case 'cancel': return refresh(await setStatus(o.id, 'cancelled', 'admin'));
    }
  });

  bot.callbackQuery(/^as:(\d+):(.+)$/, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Только для Алии');
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    await confirmSum(ctx, ctx.match[2], Number(ctx.match[1]));
  });

  async function confirmSum(ctx: Ctx, orderId: string, rub: number) {
    ctx.session.step = { k: 'idle' };
    const o = await store.getOrder(orderId);
    if (!o) return;
    const total_thb = o.items.reduce((s, i) => s + (i.item_status === 'unavailable' ? 0 : i.price_thb * i.qty), 0) || null;
    await store.updateOrder(orderId, { total_rub: rub, total_thb });
    const u = await setStatus(orderId, 'confirmed', 'admin');
    await ctx.reply(`✅ ${orderNo(u)}: сумма ${fmtRub(rub)} отправлена клиенту.`);
    await sendAdminCard(u);
  }

  bot.callbackQuery(/^ap:(label|done):(.+)$/, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Только для Алии');
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    const [, what, id] = ctx.match;
    if (what === 'label') {
      ctx.session.step = { k: 'adm_photos', orderId: id, kind: 'label', count: 0 };
      return ctx.reply('🏷 Теперь фото этикетки, потом «Готово».',
        { reply_markup: new InlineKeyboard().text('Готово ✅', `ap:done:${id}`) });
    }
    ctx.session.step = { k: 'idle' };
    const o = await store.getOrder(id);
    if (!o) return;
    for (const it of o.items) if (it.item_status === 'pending') await store.updateItem(it.id, { item_status: 'bought' });
    const u = await setStatus(id, 'bought', 'admin');
    await ctx.reply(`🛍 ${orderNo(u)} выкуплен, клиент получил фото.`);
    await sendAdminCard(u);
  });

  bot.callbackQuery(/^au:(\d+):(.+)$/, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Только для Алии');
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    ctx.session.step = { k: 'adm_unavail', orderId: ctx.match[2], idx: Number(ctx.match[1]) };
    await ctx.reply('Что предложить взамен? Напишите (например, «есть L или этот же цвет в M») или нажмите «Без замены».',
      { reply_markup: new InlineKeyboard().text('Без замены', `aun:${ctx.match[2]}`) });
  });
  bot.callbackQuery(/^aun:(.+)$/, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Только для Алии');
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    const s = ctx.session.step;
    if (s.k === 'adm_unavail' && s.orderId === ctx.match[1]) await markUnavailable(ctx, s.orderId, s.idx, null);
  });

  async function markUnavailable(ctx: Ctx, orderId: string, idx: number, note: string | null) {
    ctx.session.step = { k: 'idle' };
    const o = await store.getOrder(orderId);
    const it = o?.items[idx];
    if (!o || !it) return;
    await store.updateItem(it.id, { item_status: 'unavailable', replacement_note: note });
    const what = [it.name || it.sku, it.color, it.size].filter(Boolean).join(', ');
    const msg = `К сожалению, нет в наличии: ${what}.` + (note ? `\nАлия предлагает: ${note}\nОтветьте через «${BTN.contact}».` : '');
    await store.addEvent({ order_id: o.id, status: null, message: msg, created_by: 'admin' });
    const left = o.items.filter((x, i) => i !== idx && x.item_status !== 'unavailable');
    if (!left.length) await setStatus(o.id, 'cancelled', 'admin', 'Все позиции закончились.');
    else await processEvents();
    await ctx.reply(`Клиенту сообщила про ${orderNo(o)}.`);
    await sendAdminCard((await store.getOrder(o.id))!);
  }

  bot.callbackQuery(/^at:(cdek|light_logistic):(.+)$/, async ctx => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Только для Алии');
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup();
    ctx.session.step = { k: 'adm_track', orderId: ctx.match[2], carrier: ctx.match[1] as Carrier };
    await ctx.reply(`Трек-номер ${CARRIER[ctx.match[1] as Carrier]}?`);
  });

  bot.command('orders', async ctx => {
    if (!isAdmin(ctx)) return;
    const list = await store.listActiveOrders();
    if (!list.length) return ctx.reply('Активных заказов нет 🎉');
    for (const o of list) await sendAdminCard(o);
  });

  // ---------- фото ----------

  bot.on('message:photo', async (ctx, next) => {
    const s = ctx.session.step;
    const fileId = ctx.message.photo.at(-1)!.file_id;
    if (s.k === 'adm_photos' && isAdmin(ctx)) {
      await store.addOrderPhoto(s.orderId, s.kind, fileId);
      s.count++;
      if (s.count === 1) await ctx.reply(s.kind === 'item' ? 'Фото вещи сохранено. Ещё или «Дальше» выше.' : 'Этикетка сохранена. Ещё или «Готово» выше.');
      return;
    }
    if (s.k === 'receipt') {
      const o = await store.getOrder(s.orderId);
      ctx.session.step = { k: 'idle' };
      await ctx.api.sendPhoto(config.adminChatId, fileId, { caption: `🧾 Чек по ${o ? orderNo(o) : 'заказу'} от ${ctx.from.first_name}` });
      return ctx.reply('Чек передала Алие ✅', mainMenu());
    }
    return next();
  });

  // ---------- ответы Алии клиенту (reply на пересланное сообщение) ----------

  bot.on('message', async (ctx, next) => {
    const reply = ctx.message.reply_to_message;
    if (!reply || !isAdmin(ctx) || ctx.chat.id !== config.adminChatId) return next();
    const tid = relay.get(reply.message_id) ?? Number((reply.text ?? reply.caption ?? '').match(/#c(\d+)/)?.[1]);
    if (!tid) return next();
    await ctx.api.sendMessage(tid, '💬 Алия:');
    await ctx.api.copyMessage(tid, ctx.chat.id, ctx.message.message_id);
    await ctx.reply('Отправлено ✅');
  });

  // ---------- текстовые шаги ----------

  bot.on('message', async ctx => {
    const s = ctx.session.step;
    const text = ctx.message.text?.trim() ?? '';

    if (s.k === 'message') {
      ctx.session.step = { k: 'idle' };
      const c = await ensureClient(ctx);
      const head = await ctx.api.sendMessage(config.adminChatId,
        `💬 Сообщение от ${clientLine(c)} #c${ctx.from.id}\nОтветьте на это сообщение, и я перешлю ответ.`, HTML);
      const copy = await ctx.api.copyMessage(config.adminChatId, ctx.chat.id, ctx.message.message_id);
      relay.set(head.message_id, ctx.from.id); relay.set(copy.message_id, ctx.from.id);
      return ctx.reply(T.messageSent, mainMenu());
    }

    // Алия
    if (isAdmin(ctx)) {
      if (s.k === 'adm_sum') {
        const rub = parseRub(text);
        return rub ? confirmSum(ctx, s.orderId, rub) : ctx.reply('Напишите сумму числом, например 4500.');
      }
      if (s.k === 'adm_unavail') return markUnavailable(ctx, s.orderId, s.idx, text || null);
      if (s.k === 'adm_track') {
        if (!text) return ctx.reply('Пришлите трек-номер текстом.');
        ctx.session.step = { k: 'idle' };
        await store.updateOrder(s.orderId, { carrier: s.carrier, tracking_number: text });
        const u = await setStatus(s.orderId, 'shipped', 'admin');
        await ctx.reply(`🚚 ${orderNo(u)} отправлен, клиент получил трек.`);
        return sendAdminCard(u);
      }
      if (s.k === 'adm_photos') return ctx.reply('Жду фото. Когда закончите, нажмите кнопку выше.');
    }

    if (!text) return ctx.reply(T.unknown, mainMenu());

    switch (s.k) {
      case 'color':
        ctx.session.draft.color = text.slice(0, 60);
        ctx.session.step = { k: 'size' };
        return pickColor(ctx, text.slice(0, 60));
      case 'size_text':
        ctx.session.draft.size = text.slice(0, 30);
        return askPrice(ctx);
      case 'price': {
        const thb = parseThb(text);
        if (!thb) return ctx.reply(T.badPrice);
        ctx.session.draft.price_thb = thb;
        return addDraft(ctx);
      }
      case 'phone':
        if (!/\d{6,}/.test(text.replace(/\D/g, ''))) return ctx.reply('Похоже, это не номер. Напишите номер телефона цифрами.');
        await store.upsertTelegramClient(ctx.from.id, { phone: text.slice(0, 30) });
        return checkout(ctx);
      case 'city':
        await store.upsertTelegramClient(ctx.from.id, { city: text.slice(0, 80) });
        return checkout(ctx);
      case 'comment':
        ctx.session.comment = text.slice(0, 500);
        return checkout(ctx);
      case 'receipt':
        ctx.session.step = { k: 'idle' };
        break;
    }
    if (findUniqloLink(text) || s.k === 'link') return startItem(ctx, text);
    return ctx.reply(T.unknown, mainMenu());
  });

  bot.catch(err => console.error('Ошибка бота:', err.error));

  return { bot, processEvents, refreshAdmins };
}
