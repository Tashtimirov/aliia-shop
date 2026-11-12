-- Общая схема Aliia Buyer: каталог, клиенты, заказы, доставка (базовая часть).
-- Источник: shared/data-model.md (v2). Модули (кабинет, доставка, примерка, бонусы, напоминания)
-- добавляют свои таблицы следующими миграциями, только добавлениями.
-- Деньги: баты в сатангах (int), рубли целыми рублями. Время в UTC.

create extension if not exists pgcrypto;

-- Каталог -------------------------------------------------------------------

create table brands (
  id text primary key,                 -- 'uniqlo', позже 'zara'
  name text not null,
  country text not null default 'TH'
);
insert into brands (id, name) values ('uniqlo', 'Uniqlo');

create table products (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references brands(id),
  source_id text not null,             -- productId у бренда, например 'E465185-000'
  name_en text not null,
  name_ru text,
  gender text,                         -- 'women' | 'men' | 'kids' | 'baby' | 'unisex'
  category text,                       -- 'tops','bottoms','outerwear','dresses','innerwear','shoes','accessories'
  description text,
  materials text,
  source_url text not null,
  images jsonb not null default '[]',  -- [{url, color_code, kind: 'main'|'model'|'flat'|'detail'}]
  fit text,                            -- 'slim' | 'regular' | 'relaxed' | 'oversized'
  size_system text,                    -- 'alpha' | 'waist_inch' | 'shoe_cm' | 'kids_cm' | 'one_size'
  rating numeric,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (brand_id, source_id)
);
create index products_listing_idx on products (brand_id, is_active, gender, category);

create table product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  sku text,
  color_code text not null,
  color_name text,                     -- у части вариантов бренд не отдаёт название
  size_code text not null,
  size_label text,
  price_thb integer not null,          -- сатанги
  base_price_thb integer not null,
  in_stock boolean not null default false,
  stock_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (product_id, color_code, size_code)
);
create index product_variants_product_idx on product_variants (product_id);

create table size_charts (
  brand_id text not null references brands(id),
  gender text not null, category text not null, size_system text not null, size_label text not null,
  chest_min int, chest_max int, waist_min int, waist_max int, hip_min int, hip_max int,
  height_min int, height_max int, foot_min numeric, foot_max numeric,
  primary key (brand_id, gender, category, size_system, size_label)
);

-- Вид для витрины: товар + минимальная цена + есть ли в наличии + скидка
create view catalog_items with (security_invoker = true) as
select p.*,
  min(v.price_thb) filter (where v.in_stock) as min_price_thb,
  min(v.price_thb) as any_min_price_thb,
  max(v.base_price_thb) as max_base_price_thb,
  bool_or(v.in_stock) as has_stock,
  bool_or(v.price_thb < v.base_price_thb) as on_sale
from products p
left join product_variants v on v.product_id = p.id
group by p.id;

-- Настройки -----------------------------------------------------------------
-- Занятые ключи: 'pricing', 'admins', 'loyalty', 'tryon', 'bot_events_cursor'

create table settings (key text primary key, value jsonb not null);
insert into settings (key, value) values
  ('pricing', '{"thb_rub": 2.6, "commission_pct": 15, "commission_min_rub": 500, "delivery_rub_per_kg": 1500}'),
  ('admins', '[]');

-- Клиенты -------------------------------------------------------------------

create table clients (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique,
  telegram_username text,
  instagram_username text,
  name text,
  phone text,
  city text,
  sizes jsonb,                         -- {top, bottom, shoes, height, chest, waist, hips}
  delivery_address jsonb,              -- {city, pvz_code, address, recipient_name, recipient_phone}
  source text,                         -- 'telegram' | 'instagram' | 'site' | 'manual'
  notes text,
  created_at timestamptz not null default now()
);

-- Заказы --------------------------------------------------------------------

create type order_status as enum (
  'new', 'confirmed', 'paid', 'bought', 'shipped', 'in_russia', 'delivered', 'cancelled'
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  number serial unique,                -- показываем как A-0001
  source text not null default 'miniapp', -- 'miniapp' | 'site' | 'bot_link' | 'manual'
  client_id uuid not null references clients(id),
  status order_status not null default 'new',
  total_thb integer, total_rub integer,
  rate_rub_per_thb numeric, commission_rub integer, delivery_rub integer, paid_rub integer,
  carrier text,                        -- 'light_logistic' | 'cdek'
  tracking_number text,
  pricing_snapshot jsonb,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_client_idx on orders (client_id, created_at desc);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  variant_id uuid references product_variants(id),
  brand_id text not null default 'uniqlo',
  sku text,                            -- products.source_id
  color text, size text, name text, url text, image_url text,
  qty int not null default 1 check (qty > 0),
  price_thb integer not null,
  item_status text not null default 'pending',  -- 'pending' | 'bought' | 'unavailable' | 'replaced'
  replacement_note text
);
create index order_items_order_idx on order_items (order_id);

create table order_photos (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  order_item_id uuid references order_items(id),
  kind text not null,                  -- 'item' | 'label' | 'receipt' | 'package'
  storage_path text,                   -- bucket 'order-photos'
  telegram_file_id text,
  created_at timestamptz not null default now()
);

create table order_events (
  id bigserial primary key,
  order_id uuid not null references orders(id) on delete cascade,
  status order_status,                 -- null = текстовое сообщение клиенту
  message text,
  created_by text,                     -- 'customer' | 'admin' | 'system'
  created_at timestamptz not null default now()
);

-- Доставка (база; модуль доставки расширяет миграцией) ----------------------

create table shipments (
  id uuid primary key default gen_random_uuid(),
  carrier text not null,               -- 'light_logistic' | 'cdek'
  tracking_number text not null,
  leg text not null,                   -- 'international' | 'domestic'
  status text,
  status_updated_at timestamptz,
  weight_g int,
  cost_rub int,
  created_at timestamptz not null default now()
);
create table shipment_orders (
  shipment_id uuid references shipments(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  primary key (shipment_id, order_id)
);

-- Доступ --------------------------------------------------------------------
-- Каталог читают все (anon), всё остальное только сервер (service_role обходит RLS).

alter table brands enable row level security;
alter table products enable row level security;
alter table product_variants enable row level security;
alter table size_charts enable row level security;
alter table settings enable row level security;
alter table clients enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_photos enable row level security;
alter table order_events enable row level security;
alter table shipments enable row level security;
alter table shipment_orders enable row level security;

create policy "catalog read" on brands for select using (true);
create policy "catalog read" on products for select using (true);
create policy "catalog read" on product_variants for select using (true);
create policy "catalog read" on size_charts for select using (true);
create policy "pricing read" on settings for select using (key = 'pricing');
