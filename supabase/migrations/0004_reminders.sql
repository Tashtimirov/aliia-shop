-- ИИ-напоминания Алии о нерешённых делах. Только добавления к shared/data-model.md.

-- Состояние каждого найденного дела: чтобы знать, что нового, что отложено и что уже решилось само.
create table reminder_state (
  id bigserial primary key,                 -- короткий id для кнопок в Telegram (callback_data до 64 байт)
  key text not null unique,                 -- '<правило>:<order_id|shipment_id>', см. src/rules.ts
  rule text not null,
  order_id uuid references orders(id) on delete cascade,
  shipment_id uuid references shipments(id) on delete cascade,
  title text not null,                      -- последний текст, для истории
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_sent_at timestamptz,
  snoozed_until timestamptz,                -- «Отложить» в боте
  dismissed_at timestamptz,                 -- «Не напоминать» в боте (пока дело не исчезнет и не появится снова)
  resolved_at timestamptz                   -- дело пропало из проверки (заказ оплатили, трек вписали и т.п.)
);
create index reminder_state_open_idx on reminder_state (resolved_at) where resolved_at is null;

-- Журнал отправленных сводок (что ушло и сколько стоил ИИ)
create table reminder_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  found int not null,
  sent int not null,
  text text,
  used_ai boolean not null default false
);

alter table reminder_state enable row level security;   -- только service_role (сервер)
alter table reminder_runs enable row level security;

-- Настройки (меняются без деплоя):
-- settings 'reminders': {"enabled": true, "hour_bkk": 9, "thresholds": {"paid_unbought": 3, ...},
--                        "min_severity": "low", "snooze_days": 1}
-- Получатели: settings.admins (telegram_id Алии и Ильдара), как у остальных админских уведомлений.
