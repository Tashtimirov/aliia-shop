import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { buildDigest, plainDigest } from './digest';
import { findOpenIssues } from './rules';
import { handleReminderCallback, runReminders, type ReminderStore } from './service';
import { plan, type ReminderState } from './state';
import { keyboard } from './telegram';
import type { Finding, OrderRow, ShipmentRow, Snapshot } from './types';

const NOW = new Date('2026-11-12T02:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const client = { id: 'c1', name: 'Анна', telegram_username: 'anna', instagram_username: null,
  delivery_address: { pvz_code: 'MSK5' } };
const order = (o: Partial<OrderRow>): OrderRow => ({
  id: 'o' + (o.number ?? 1), number: 1, client_id: 'c1', status: 'new', total_rub: 5000, paid_rub: null,
  tracking_number: null, created_at: ago(10), updated_at: ago(0), status_since: ago(0), items: [], photo_kinds: [], ...o,
});
const ship = (s: Partial<ShipmentRow>): ShipmentRow => ({
  id: 's1', carrier: 'cdek', leg: 'domestic', tracking_number: '123', state: 'in_transit',
  status_updated_at: ago(0), created_at: ago(0), order_ids: [], ...s,
});
const snap = (orders: OrderRow[], shipments: ShipmentRow[] = []): Snapshot => ({ now: NOW, clients: [client], orders, shipments });
const rules = (s: Snapshot) => findOpenIssues(s).map((f) => f.rule);

describe('правила', () => {
  it('свежие заказы не трогает, просроченные находит', () => {
    expect(rules(snap([order({ status: 'new', status_since: ago(0) })]))).toEqual([]);
    expect(rules(snap([order({ status: 'new', status_since: ago(2) })]))).toEqual(['new_unconfirmed']);
    expect(rules(snap([order({ status: 'confirmed', status_since: ago(3) })]))).toEqual(['confirmed_unpaid']);
  });

  it('оплаченный и невыкупленный: срочно, с номером и именем', () => {
    const [f] = findOpenIssues(snap([order({ number: 12, status: 'paid', paid_rub: 5000, status_since: ago(4) })]));
    expect(f).toMatchObject({ rule: 'paid_unbought', severity: 'urgent', days: 4 });
    expect(f.title).toBe('A-0012 Анна: оплачен 4 дн. назад, ещё не выкуплен');
  });

  it('выкуплен: фото, адрес, недоплата, нет в наличии без решения', () => {
    const r = rules({ ...snap([order({
      status: 'bought', paid_rub: 3000, status_since: ago(1), photo_kinds: ['item'],
      items: [{ id: 'i1', name: 'Кардиган', size: 'M', item_status: 'unavailable', replacement_note: null }],
    })]), clients: [{ ...client, delivery_address: null }] });
    expect(r.sort()).toEqual(['missing_photos', 'no_address', 'unavailable_no_decision', 'underpaid'].sort());
  });

  it('отправлен без трека — срочно; трек в отправлении считается', () => {
    expect(rules(snap([order({ status: 'shipped', paid_rub: 5000, photo_kinds: ['item', 'label'] })]))).toEqual(['no_tracking']);
    expect(rules(snap([order({ status: 'shipped', paid_rub: 5000, photo_kinds: ['item', 'label'] })], [ship({ order_ids: ['o1'] })]))).toEqual([]);
  });

  it('посылки: проблема, ПВЗ, таможня, тишина', () => {
    expect(rules(snap([], [ship({ state: 'problem' })]))).toEqual(['shipment_problem']);
    expect(rules(snap([], [ship({ state: 'at_pickup_point', status_updated_at: ago(5) })]))).toEqual(['pickup_waiting']);
    expect(rules(snap([], [ship({ state: 'customs', status_updated_at: ago(6) })]))).toEqual(['customs_long']);
    expect(rules(snap([], [ship({ carrier: 'light_logistic', status_updated_at: ago(9) })]))).toEqual(['shipment_silent']);
    expect(rules(snap([], [ship({ state: 'draft', tracking_number: null, created_at: ago(3), status_updated_at: null })]))).toEqual(['draft_no_track']);
  });

  it('доставленные и отменённые не трогает, срочные идут первыми', () => {
    expect(rules(snap([order({ status: 'cancelled', status_since: ago(30) }), order({ number: 2, status: 'delivered' })]))).toEqual([]);
    const f = findOpenIssues(snap([order({ status: 'confirmed', status_since: ago(9) }), order({ number: 2, status: 'paid', paid_rub: 5000, status_since: ago(4) })]));
    expect(f.map((x) => x.severity)).toEqual(['urgent', 'normal']);
  });
});

describe('что слать', () => {
  const f: Finding = { key: 'k1', rule: 'r', severity: 'normal', title: 'A-0001 Анна: x', action: 'y', days: 3 };
  const st = (s: Partial<ReminderState>): ReminderState => ({ id: 1, key: 'k1', first_seen_at: ago(3), last_sent_at: null, snoozed_until: null, dismissed_at: null, resolved_at: null, ...s });

  it('новое помечает, отложенное и «не напоминать» пропускает, исчезнувшее закрывает', () => {
    expect(plan([f], [], NOW).send[0].is_new).toBe(true);
    expect(plan([f], [st({})], NOW).send[0]).toMatchObject({ is_new: false, state_id: 1 });
    expect(plan([f], [st({ snoozed_until: ago(-1) })], NOW).send).toEqual([]);
    expect(plan([f], [st({ snoozed_until: ago(1) })], NOW).send).toHaveLength(1);
    expect(plan([f], [st({ dismissed_at: ago(1) })], NOW).skipped).toBe(1);
    expect(plan([], [st({})], NOW).resolvedKeys).toEqual(['k1']);
  });

  it('простая сводка и кнопки в лимитах Telegram', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...f, key: 'k' + i, state_id: 100000 + i, is_new: i < 3 }));
    const p = { send: many, skipped: 0, resolvedKeys: [] };
    expect(plainDigest(p).length).toBeLessThanOrEqual(3800);
    const kb = keyboard(p)!;
    expect(kb.inline_keyboard).toHaveLength(8);
    for (const row of kb.inline_keyboard) for (const b of row) expect(new TextEncoder().encode(b.callback_data).length).toBeLessThanOrEqual(64);
    expect(plainDigest({ send: [], skipped: 0, resolvedKeys: [] })).toContain('нет');
  });

  it('если ИИ упал, уходит простой список', async () => {
    const broken = { beta: { messages: { create: async () => { throw new Error('down'); } } } } as unknown as Anthropic;
    const r = await buildDigest({ send: [{ ...f, is_new: true }], skipped: 0, resolvedKeys: [] }, { client: broken });
    expect(r.usedAi).toBe(false);
    expect(r.text).toContain('A-0001 Анна');
  });
});

function memStore(s: Snapshot): ReminderStore & { rows: Map<string, ReminderState & { title: string }>; runs: unknown[] } {
  const rows = new Map<string, ReminderState & { title: string }>();
  const runs: unknown[] = [];
  let seq = 0;
  const byId = (id: number) => [...rows.values()].find((r) => r.id === id && !r.resolved_at);
  return {
    rows, runs,
    snapshot: async () => s,
    settings: async () => ({ reminders: {}, admins: [111] }),
    states: async () => [...rows.values()].filter((r) => !r.resolved_at),
    async touch(fs, now) {
      for (const f of fs) {
        const r = rows.get(f.key);
        if (!r || r.resolved_at) rows.set(f.key, { id: ++seq, key: f.key, title: f.title, first_seen_at: now.toISOString(), last_sent_at: null, snoozed_until: null, dismissed_at: null, resolved_at: null });
      }
      return new Map(fs.map((f) => [f.key, rows.get(f.key)!.id]));
    },
    async markSent(keys, now) { for (const k of keys) rows.get(k)!.last_sent_at = now.toISOString(); },
    async markResolved(keys, now) { for (const k of keys) rows.get(k)!.resolved_at = now.toISOString(); },
    async logRun(r) { runs.push(r); },
    async snooze(id, until) { const r = byId(id); if (!r) return null; r.snoozed_until = until.toISOString(); return r.title; },
    async dismiss(id, now) { const r = byId(id); if (!r) return null; r.dismissed_at = now.toISOString(); return r.title; },
  };
}

describe('запуск целиком', () => {
  it('шлёт сводку с кнопками, кнопка откладывает, решённое закрывается', async () => {
    const s = snap([order({ number: 7, status: 'paid', paid_rub: 5000, status_since: ago(5) })]);
    const store = memStore(s);
    const sent: { text: string; reply_markup: { inline_keyboard: { callback_data: string }[][] } }[] = [];
    const f = (async (_u: string, init: RequestInit) => { sent.push(JSON.parse(init.body as string)); return new Response('{}'); }) as unknown as typeof fetch;

    const r1 = await runReminders(store, { telegramToken: 't', now: NOW, ai: false, fetch: f });
    expect(r1).toMatchObject({ found: 1, sent: 1, delivered: 1 });
    expect(sent[0].text).toContain('🆕 A-0007 Анна');
    const cb = sent[0].reply_markup.inline_keyboard[0][0].callback_data;

    expect(await handleReminderCallback(store, cb, NOW)).toBe('Отложено до завтра: A-0007 Анна');
    expect(await handleReminderCallback(store, 'other:1', NOW)).toBeNull();
    const r2 = await runReminders(store, { telegramToken: 't', now: NOW, ai: false, fetch: f });
    expect(r2).toMatchObject({ sent: 0, skipped: 1 });
    expect(sent[1].text).toContain('Нерешённых дел нет');

    s.orders[0].status = 'bought'; s.orders[0].photo_kinds = ['item', 'label']; s.orders[0].status_since = NOW.toISOString();
    const r3 = await runReminders(store, { telegramToken: 't', now: NOW, ai: false, fetch: f });
    expect(r3).toMatchObject({ found: 0, resolved: 1 });
  });
});
