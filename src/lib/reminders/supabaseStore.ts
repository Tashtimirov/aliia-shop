// Хранилище на Supabase (service_role, только на сервере).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ReminderSettings, ReminderStore } from './service';
import type { ReminderState } from './state';
import type { ClientRow, OrderRow, ShipmentRow } from './types';

const ok = <T>({ data, error }: { data: T | null; error: unknown }) => {
  if (error) throw error;
  return data as T;
};

export function supabaseReminderStore(db: SupabaseClient): ReminderStore {
  return {
    async snapshot(now) {
      type O = Omit<OrderRow, 'status_since' | 'items' | 'photo_kinds'> & {
        order_items: OrderRow['items']; order_photos: { kind: string }[]; order_events: { status: string | null; created_at: string }[];
      };
      const orders = ok(await db.from('orders')
        .select('id, number, client_id, status, total_rub, paid_rub, tracking_number, created_at, updated_at, order_items(id, name, size, item_status, replacement_note), order_photos(kind), order_events(status, created_at)')
        .not('status', 'in', '(delivered,cancelled)')) as unknown as O[];

      const clientIds = [...new Set(orders.map((o) => o.client_id))];
      const clients = clientIds.length
        ? ok(await db.from('clients').select('id, name, telegram_username, instagram_username, delivery_address').in('id', clientIds)) as ClientRow[]
        : [];

      type S = Omit<ShipmentRow, 'order_ids'> & { shipment_orders: { order_id: string }[] };
      const ships = ok(await db.from('shipments')
        .select('id, carrier, leg, tracking_number, state, status_updated_at, created_at, shipment_orders(order_id)')
        .not('state', 'in', '(delivered,returned,cancelled)')) as unknown as S[];

      return {
        now,
        clients,
        orders: orders.map(({ order_items, order_photos, order_events, ...o }) => ({
          ...o,
          items: order_items ?? [],
          photo_kinds: (order_photos ?? []).map((p) => p.kind),
          status_since: (order_events ?? []).filter((e) => e.status === o.status)
            .map((e) => e.created_at).sort().at(-1) ?? o.updated_at,
        })),
        shipments: ships.map(({ shipment_orders, ...s }) => ({ ...s, order_ids: (shipment_orders ?? []).map((x) => x.order_id) })),
      };
    },

    async settings() {
      const rows = ok(await db.from('settings').select('key, value').in('key', ['reminders', 'admins'])) as { key: string; value: unknown }[];
      const get = (k: string) => rows.find((r) => r.key === k)?.value;
      return {
        reminders: (get('reminders') ?? {}) as ReminderSettings,
        admins: (Array.isArray(get('admins')) ? get('admins') : []) as (number | string)[],
      };
    },

    async states() {
      return ok(await db.from('reminder_state')
        .select('id, key, first_seen_at, last_sent_at, snoozed_until, dismissed_at, resolved_at')
        .is('resolved_at', null)) as ReminderState[];
    },

    async touch(findings, now) {
      if (!findings.length) return new Map();
      // Дело, которое уже решалось и вернулось, начинается заново (сбрасываем отложено/не напоминать).
      const rows = findings.map((f) => ({
        key: f.key, rule: f.rule, order_id: f.order_id ?? null, shipment_id: f.shipment_id ?? null,
        title: f.title, last_seen_at: now.toISOString(),
      }));
      const reopened = ok(await db.from('reminder_state').select('key').in('key', findings.map((f) => f.key)).not('resolved_at', 'is', null)) as { key: string }[];
      if (reopened.length)
        ok(await db.from('reminder_state').update({ resolved_at: null, snoozed_until: null, dismissed_at: null, first_seen_at: now.toISOString() })
          .in('key', reopened.map((r) => r.key)));
      const data = ok(await db.from('reminder_state').upsert(rows, { onConflict: 'key' }).select('id, key')) as { id: number; key: string }[];
      return new Map(data.map((r) => [r.key, r.id]));
    },

    async markSent(keys, now) {
      if (keys.length) ok(await db.from('reminder_state').update({ last_sent_at: now.toISOString() }).in('key', keys));
    },
    async markResolved(keys, now) {
      if (keys.length) ok(await db.from('reminder_state').update({ resolved_at: now.toISOString() }).in('key', keys));
    },
    async logRun(r) {
      ok(await db.from('reminder_runs').insert(r));
    },
    async snooze(id, until) {
      const d = ok(await db.from('reminder_state').update({ snoozed_until: until.toISOString() }).eq('id', id).is('resolved_at', null).select('title')) as { title: string }[];
      return d[0]?.title ?? null;
    },
    async dismiss(id, now) {
      const d = ok(await db.from('reminder_state').update({ dismissed_at: now.toISOString() }).eq('id', id).is('resolved_at', null).select('title')) as { title: string }[];
      return d[0]?.title ?? null;
    },
  };
}
