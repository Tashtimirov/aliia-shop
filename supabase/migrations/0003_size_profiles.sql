-- Личный кабинет: профили размеров, избранное, журнал ИИ-подборок. Применять до 0009_try_on.sql (там ссылка на size_profiles).
-- Только добавления к 0001_core.sql. Доступ, как и к clients: только сервер (service role),
-- клиент приходит через API с проверенным initData Telegram.

create table size_profiles (               -- несколько профилей на клиента: «Я», «Муж», «Дочка»
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  label text not null default 'Я',
  is_primary boolean not null default false, -- основной профиль, копируется в clients.sizes для CRM и бота
  gender text not null check (gender in ('women','men','kids')),
  height_cm int check (height_cm between 50 and 230),
  weight_kg int check (weight_kg between 3 and 250),
  chest_cm int check (chest_cm between 40 and 170),
  waist_cm int check (waist_cm between 35 and 170),
  hips_cm int check (hips_cm between 40 and 180),
  foot_cm numeric(4,1) check (foot_cm between 10 and 35),
  ru_size int check (ru_size between 26 and 80),  -- привычный российский размер: 42, 44, 46...
  usual_top text,                           -- 'XS'..'4XL'
  usual_bottom text,                        -- 'XS'..'4XL'
  jeans_waist_inch int check (jeans_waist_inch between 20 and 48),
  fit_preference text not null default 'regular' check (fit_preference in ('tight','regular','oversize')),
  style_notes text,                         -- пожелания по стилю, идут в ИИ-подбор
  -- виртуальная примерка: одно фото в полный рост, только с согласием
  tryon_photo_path text,                    -- bucket 'tryon-photos' (приватный): {client_id}/{profile_id}.jpg
  tryon_consent_at timestamptz,
  updated_at timestamptz not null default now(),  -- меняется и при замене фото: по нему сбрасывается кэш примерок
  constraint tryon_photo_needs_consent check (tryon_photo_path is null or tryon_consent_at is not null)
);
create index size_profiles_client_idx on size_profiles (client_id);
create unique index size_profiles_one_primary on size_profiles (client_id) where is_primary;

create table favorites (
  client_id uuid not null references clients(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  profile_id uuid references size_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (client_id, product_id)
);

create table ai_recommendations (          -- что спросили и что предложил ИИ: для качества и учёта расходов
  id bigserial primary key,
  client_id uuid references clients(id) on delete cascade,
  profile_id uuid references size_profiles(id) on delete set null,
  request text,
  result jsonb not null,                    -- {summary, picks:[{product_id, size_label, color_code, reason}]}
  model text not null,
  input_tokens int, output_tokens int,
  created_at timestamptz not null default now()
);

-- Основной профиль копируется в clients.sizes ({top, bottom, shoes, height, chest, waist, hips}, см. 0001).
create or replace function sync_primary_sizes() returns trigger language plpgsql as $$
begin
  if new.is_primary then
    update clients set sizes = jsonb_strip_nulls(jsonb_build_object(
      'top', new.usual_top, 'bottom', coalesce(new.usual_bottom, new.jeans_waist_inch::text || 'inch'),
      'shoes', new.foot_cm, 'height', new.height_cm, 'chest', new.chest_cm,
      'waist', new.waist_cm, 'hips', new.hips_cm))
    where id = new.client_id;
  end if;
  return new;
end $$;
create trigger size_profiles_sync after insert or update on size_profiles
  for each row execute function sync_primary_sizes();

alter table size_profiles enable row level security;
alter table favorites enable row level security;
alter table ai_recommendations enable row level security;
