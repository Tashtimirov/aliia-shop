-- Доставка с отслеживанием: расширение таблиц shipments / shipment_orders из shared/data-model.md
-- Только добавляем поля, существующие не переименовываем.

-- Нормализованный статус отправления (единый для всех перевозчиков)
create type shipment_state as enum (
  'draft',            -- заведено, трек ещё не получен
  'created',          -- заявка у перевозчика есть, посылку ещё не сдали
  'accepted',         -- перевозчик принял посылку
  'in_transit',       -- в пути
  'customs',          -- на таможне
  'arrived_russia',   -- пришло в РФ (для международного плеча)
  'at_pickup_point',  -- ждёт в ПВЗ / постамате
  'out_for_delivery', -- у курьера
  'delivered',        -- вручено
  'problem',          -- не вручено, ошибка, возврат
  'returned',
  'cancelled'
);

alter table shipments
  add column state shipment_state not null default 'draft',
  add column carrier_status_code text,     -- код перевозчика как есть, например 'ACCEPTED_AT_PICK_UP_POINT'
  add column carrier_order_id text,        -- uuid заказа в СДЭК
  add column city text,                    -- последний известный город
  add column tracking_url text,            -- ссылка для клиента
  add column client_id uuid references clients(id),  -- получатель (для domestic-плеча всегда один клиент)
  add column recipient jsonb,              -- {name, phone, city_code, pvz_code, address}
  add column created_by text not null default 'admin', -- 'admin' | 'system'
  add column last_polled_at timestamptz,
  add column delivered_at timestamptz;

-- tracking_number может появиться позже (заявку в СДЭК создали, номер ещё не присвоен)
alter table shipments alter column tracking_number drop not null;
create unique index shipments_carrier_tracking_uq on shipments (carrier, tracking_number) where tracking_number is not null;
create index shipments_active_idx on shipments (state) where state not in ('delivered','returned','cancelled');

-- История статусов отправления (то, что видит клиент на странице заказа)
create table shipment_events (
  id bigserial primary key,
  shipment_id uuid not null references shipments(id) on delete cascade,
  state shipment_state not null,
  carrier_status_code text,
  title text not null,                     -- по-русски, для клиента
  city text,
  happened_at timestamptz not null,
  source text not null,                    -- 'webhook' | 'poll' | 'admin'
  created_at timestamptz not null default now(),
  unique (shipment_id, carrier_status_code, happened_at)  -- вебхук и опрос не задвоят событие
);

-- Учётные данные и настройки перевозчиков (секреты НЕ здесь, а в env)
-- settings 'shipping': {"cdek_sender_pvz": "MSK123", "cdek_tariff_code": 136, "cdek_order_type": 2,
--                        "default_package": {"weight_g": 1000, "length": 30, "width": 20, "height": 10}}

-- Доступ: как и остальное, только сервер (service_role). Клиентские политики добавит ветка личного кабинета.
alter table shipment_events enable row level security;
