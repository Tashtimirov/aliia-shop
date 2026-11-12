-- Виртуальная примерка по фото. Поверх 0001_core.sql и миграции личного кабинета (size_profiles.tryon_photo_path):
-- применять после неё. Только добавления.

create table tryon_results (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  profile_id uuid not null references size_profiles(id) on delete cascade, -- удалили профиль: удаляются и примерки
  product_id uuid not null references products(id) on delete cascade,
  color_code text not null,
  base_result_id uuid references tryon_results(id) on delete set null, -- «примерить с этим»: надето поверх прошлой примерки
  photo_version text not null,            -- size_profiles.updated_at на момент примерки; сменили фото = новый ключ кэша
  provider text not null,                 -- 'fashn' | 'kling'
  status text not null default 'pending' check (status in ('pending','done','failed')),
  result_path text,                       -- bucket 'tryon-results' (приватный): {client_id}/{id}.jpg
  cost_usd numeric(6,4),                  -- для учёта расходов
  error text,
  created_at timestamptz not null default now()
);
-- одна и та же примерка не генерируется дважды (повторный клик берёт из кэша)
create unique index tryon_cache on tryon_results
  (profile_id, product_id, color_code, photo_version, coalesce(base_result_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status <> 'failed';
create index on tryon_results (client_id, created_at desc);

alter table tryon_results enable row level security;
create policy own_tryons on tryon_results for select using (client_id = (auth.jwt() ->> 'client_id')::uuid);
-- запись только сервером (service_role)

-- Настройки: лимит в день и провайдер. Алия меняет в одном месте.
insert into settings (key, value) values
  ('tryon', '{"provider": "fashn", "mode": "balanced", "daily_limit": 10, "daily_limit_vip": 40}')
on conflict (key) do nothing;

-- Storage: создать приватный bucket 'tryon-results' (bucket 'tryon-photos' создаёт ветка личного кабинета).
insert into storage.buckets (id, name, public) values ('tryon-results', 'tryon-results', false)
on conflict (id) do nothing;
