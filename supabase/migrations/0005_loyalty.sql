-- Бонусная программа «Клуб Алии»: уровни, кэшбэк, приветственные, «приведи подругу», отзывы, день рождения.
-- Только добавления к 0001_core.sql. 1 бонус = 1 ₽, суммы целыми рублями. Время в UTC.
-- Правила для людей: docs/loyalty.md. Все проценты и суммы в settings.loyalty (Алия меняет без программиста).
--
-- Как устроено:
--  * bonus_transactions — журнал, строки только добавляются. Начисления (amount_rub > 0, kind <> 'redeem_refund')
--    хранят remaining_rub — сколько от них ещё не потрачено и не сгорело. Списания расходуют начисления
--    по FIFO (раньше сгорающие первыми), разбивка пишется в bonus_allocations, чтобы при отмене заказа
--    вернуть бонусы в те же начисления с тем же сроком.
--  * Инвариант: sum(amount_rub) = sum(remaining_rub) по клиенту.
--  * Всё денежное считает база (триггер на orders), приложение только просит списать N бонусов.

-- Настройки -----------------------------------------------------------------

insert into settings (key, value) values ('loyalty', '{
  "tiers": [
    {"code": "new",    "name": "Новичок", "min_spent_rub": 0,      "cashback_pct": 3},
    {"code": "friend", "name": "Подруга", "min_spent_rub": 30000,  "cashback_pct": 5},
    {"code": "vip",    "name": "VIP",     "min_spent_rub": 100000, "cashback_pct": 7}
  ],
  "tier_window_months": 12,
  "tier_downgrade_grace_months": 3,
  "welcome_rub": 300, "welcome_valid_days": 60,
  "referral_friend_rub": 500, "referral_inviter_rub": 500, "referral_min_order_rub": 3000,
  "review_rub": 200,
  "birthday_rub": 500, "birthday_days_before": 7, "birthday_valid_days": 14,
  "expire_months": 12, "expire_warn_days": 14,
  "max_redeem_pct_of_commission": 50
}') on conflict (key) do nothing;

-- Поля в общих таблицах -----------------------------------------------------

alter table clients
  add column referral_code text unique,                    -- 6 символов, для ссылки t.me/<бот>?start=ref_<код>
  add column referred_by uuid references clients(id),
  add column birthday date,
  add column loyalty_tier text not null default 'new',      -- code из settings.loyalty.tiers
  add column tier_since timestamptz not null default now();

alter table orders
  add column bonus_spent_rub integer not null default 0 check (bonus_spent_rub >= 0),  -- к оплате: total_rub - bonus_spent_rub
  add column bonus_earned_rub integer not null default 0,
  add column delivered_at timestamptz;

-- Таблицы -------------------------------------------------------------------

create table bonus_transactions (
  id bigserial primary key,
  client_id uuid not null references clients(id) on delete cascade,
  amount_rub integer not null check (amount_rub <> 0),     -- + начисление, − списание/сгорание
  kind text not null check (kind in (
    'welcome', 'cashback', 'referral_friend', 'referral_inviter', 'review', 'birthday', 'manual',
    'redeem', 'redeem_refund', 'cashback_reversal', 'expire')),
  order_id uuid references orders(id) on delete set null,
  remaining_rub integer check (remaining_rub >= 0),        -- только у начислений
  expires_at timestamptz,                                  -- только у начислений
  only_first_order boolean not null default false,         -- приветственные и бонус подруги
  expiry_warned boolean not null default false,
  comment text,
  created_by text not null default 'system',               -- 'system' | 'admin:<telegram_id>'
  created_at timestamptz not null default now()
);
create index bonus_tx_client_idx on bonus_transactions (client_id, created_at desc);
create index bonus_tx_open_idx on bonus_transactions (client_id, expires_at) where remaining_rub > 0;
create unique index bonus_tx_once_per_order on bonus_transactions (order_id, kind)
  where kind in ('cashback', 'review', 'redeem', 'redeem_refund', 'cashback_reversal', 'referral_inviter');

create table bonus_allocations (                           -- какое списание из какого начисления взято
  debit_id bigint not null references bonus_transactions(id) on delete cascade,
  credit_id bigint not null references bonus_transactions(id) on delete cascade,
  amount_rub integer not null check (amount_rub > 0),
  primary key (debit_id, credit_id)
);

create table referrals (
  invitee_id uuid primary key references clients(id) on delete cascade,
  inviter_id uuid not null references clients(id) on delete cascade,
  rewarded_order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now(),
  check (invitee_id <> inviter_id)
);

create table loyalty_notices (                             -- лента уведомлений для бота
  id bigserial primary key,
  client_id uuid not null references clients(id) on delete cascade,
  kind text not null,          -- 'credit' | 'tier_up' | 'tier_down' | 'expiring' | 'expired'
  text text not null,
  notified_at timestamptz,     -- бот проставляет после отправки
  created_at timestamptz not null default now()
);
create index loyalty_notices_pending_idx on loyalty_notices (id) where notified_at is null;

alter table bonus_transactions enable row level security;
alter table bonus_allocations enable row level security;
alter table referrals enable row level security;
alter table loyalty_notices enable row level security;
-- Политик нет: читает и пишет только сервер (service_role), как и остальные клиентские данные.

-- Вспомогательные -----------------------------------------------------------

create function loyalty_cfg() returns jsonb language sql stable as $$
  select coalesce((select value from settings where key = 'loyalty'), '{}'::jsonb)
$$;

create function loyalty_tier(p_code text) returns jsonb language sql stable as $$
  select t from jsonb_array_elements(loyalty_cfg() -> 'tiers') t where t ->> 'code' = p_code
  union all select (loyalty_cfg() -> 'tiers') -> 0
  limit 1
$$;

create function loyalty_new_referral_code() returns text language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- без 0/O и 1/I
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from clients where referral_code = code);
  end loop;
  return code;
end $$;

-- Первый ли это заказ клиента: других заказов дальше 'new' (и не отменённых) нет.
create function loyalty_is_first_order(p_client uuid, p_order uuid) returns boolean language sql stable as $$
  select not exists (
    select 1 from orders
    where client_id = p_client and id is distinct from p_order and status not in ('new', 'cancelled'))
$$;

-- Сколько бонусов клиент может потратить прямо сейчас.
create function loyalty_available(p_client uuid, p_first_order boolean) returns integer language sql stable as $$
  select coalesce(sum(remaining_rub), 0)::int from bonus_transactions
  where client_id = p_client and remaining_rub > 0
    and (expires_at is null or expires_at > now())
    and (not only_first_order or p_first_order)
$$;

-- Потолок списания: процент от комиссии, не больше доступного.
create function loyalty_redeem_cap(p_client uuid, p_order uuid, p_commission_rub integer) returns integer
language sql stable as $$
  select greatest(0, least(
    loyalty_available(p_client, loyalty_is_first_order(p_client, p_order)),
    floor(coalesce(p_commission_rub, 0) * (loyalty_cfg() ->> 'max_redeem_pct_of_commission')::numeric / 100)::int))
$$;

-- Для корзины и бота: сколько можно списать в этом заказе.
create function loyalty_max_redeem(p_order_id uuid) returns integer language sql stable as $$
  select loyalty_redeem_cap(client_id, id, commission_rub) from orders where id = p_order_id
$$;

-- Начисление.
create function loyalty_credit(
  p_client uuid, p_amount integer, p_kind text, p_order uuid default null, p_valid_days integer default null,
  p_only_first_order boolean default false, p_comment text default null, p_created_by text default 'system',
  p_notice text default null
) returns bigint language plpgsql as $$
declare
  tx_id bigint;
begin
  if p_amount is null or p_amount <= 0 then return null; end if;
  insert into bonus_transactions (client_id, amount_rub, kind, order_id, remaining_rub, expires_at,
                                  only_first_order, comment, created_by)
  values (p_client, p_amount, p_kind, p_order, p_amount,
          case when p_valid_days is not null then now() + make_interval(days => p_valid_days)
               else now() + make_interval(months => (loyalty_cfg() ->> 'expire_months')::int) end,
          p_only_first_order, p_comment, p_created_by)
  returning id into tx_id;
  insert into loyalty_notices (client_id, kind, text)
  values (p_client, 'credit', coalesce(p_notice, format('Начислено %s бонусов', p_amount)));
  return tx_id;
end $$;

-- Списание по FIFO. Возвращает сколько реально списано (не больше доступного).
create function loyalty_debit(
  p_client uuid, p_amount integer, p_kind text, p_order uuid default null, p_first_order boolean default false,
  p_comment text default null, p_created_by text default 'system'
) returns integer language plpgsql as $$
declare
  want integer := greatest(coalesce(p_amount, 0), 0);
  taken integer := 0;
  part integer;
  debit_id bigint;
  c record;
  allocs jsonb := '[]';
begin
  if want = 0 then return 0; end if;
  for c in
    select id, remaining_rub from bonus_transactions
    where client_id = p_client and remaining_rub > 0
      and (expires_at is null or expires_at > now())
      and (not only_first_order or p_first_order)
    order by only_first_order desc, expires_at nulls last, id
    for update
  loop
    exit when taken >= want;
    part := least(c.remaining_rub, want - taken);
    update bonus_transactions set remaining_rub = remaining_rub - part where id = c.id;
    allocs := allocs || jsonb_build_object('credit_id', c.id, 'amount', part);
    taken := taken + part;
  end loop;
  if taken = 0 then return 0; end if;
  insert into bonus_transactions (client_id, amount_rub, kind, order_id, comment, created_by)
  values (p_client, -taken, p_kind, p_order, p_comment, p_created_by)
  returning id into debit_id;
  insert into bonus_allocations (debit_id, credit_id, amount_rub)
  select debit_id, (a ->> 'credit_id')::bigint, (a ->> 'amount')::int from jsonb_array_elements(allocs) a;
  return taken;
end $$;

-- Вернуть списанное по заказу в те же начисления (при отмене).
create function loyalty_refund_redeem(p_order uuid) returns integer language plpgsql as $$
declare
  d record;
  refunded integer := 0;
begin
  select * into d from bonus_transactions where order_id = p_order and kind = 'redeem';
  if not found or exists (select 1 from bonus_transactions where order_id = p_order and kind = 'redeem_refund') then
    return 0;
  end if;
  update bonus_transactions c set remaining_rub = c.remaining_rub + a.amount_rub
  from bonus_allocations a where a.debit_id = d.id and c.id = a.credit_id;
  refunded := -d.amount_rub;
  insert into bonus_transactions (client_id, amount_rub, kind, order_id, comment)
  values (d.client_id, refunded, 'redeem_refund', p_order, 'Заказ отменён, бонусы вернулись');
  insert into loyalty_notices (client_id, kind, text)
  values (d.client_id, 'credit', format('Заказ отменён, вернули %s бонусов', refunded));
  return refunded;
end $$;

-- Сумма покупок для уровня: доставленные заказы за окно (без доставки и без оплаченного бонусами).
create function loyalty_spent(p_client uuid) returns integer language sql stable as $$
  select coalesce(sum(coalesce(total_rub, 0) - coalesce(delivery_rub, 0) - bonus_spent_rub), 0)::int
  from orders
  where client_id = p_client and status = 'delivered'
    and delivered_at > now() - make_interval(months => (loyalty_cfg() ->> 'tier_window_months')::int)
$$;

-- Пересчитать уровень. Повышение сразу, понижение не раньше чем через grace месяцев после смены уровня.
create function loyalty_recalc_tier(p_client uuid) returns text language plpgsql as $$
declare
  cl clients;
  spent integer := loyalty_spent(p_client);
  target jsonb;
  cur_min integer;
  tgt_min integer;
begin
  select * into cl from clients where id = p_client for update;
  if not found then return null; end if;
  select t into target from jsonb_array_elements(loyalty_cfg() -> 'tiers') t
  where (t ->> 'min_spent_rub')::int <= spent order by (t ->> 'min_spent_rub')::int desc limit 1;
  if target is null or target ->> 'code' = cl.loyalty_tier then return cl.loyalty_tier; end if;
  cur_min := (loyalty_tier(cl.loyalty_tier) ->> 'min_spent_rub')::int;
  tgt_min := (target ->> 'min_spent_rub')::int;
  if tgt_min > cur_min then
    update clients set loyalty_tier = target ->> 'code', tier_since = now() where id = p_client;
    insert into loyalty_notices (client_id, kind, text) values (p_client, 'tier_up',
      format('Ваш уровень теперь «%s»: кэшбэк %s%% бонусами', target ->> 'name', target ->> 'cashback_pct'));
  elsif cl.tier_since < now() - make_interval(months => (loyalty_cfg() ->> 'tier_downgrade_grace_months')::int) then
    update clients set loyalty_tier = target ->> 'code', tier_since = now() where id = p_client;
    insert into loyalty_notices (client_id, kind, text) values (p_client, 'tier_down',
      format('Ваш уровень теперь «%s». Чтобы вернуть прежний, нужно покупок на %s ₽ за год',
             target ->> 'name', cur_min));
  else
    return cl.loyalty_tier;
  end if;
  return target ->> 'code';
end $$;

-- Триггеры: клиенты -----------------------------------------------------------

create function loyalty_clients_before_insert() returns trigger language plpgsql as $$
begin
  new.referral_code := coalesce(new.referral_code, loyalty_new_referral_code());
  return new;
end $$;
create trigger loyalty_clients_before_insert before insert on clients
  for each row execute function loyalty_clients_before_insert();

-- Приветственные бонусы тем, кто пришёл через Telegram (клиенты, заведённые Алией вручную, их не получают).
create function loyalty_clients_after_insert() returns trigger language plpgsql as $$
declare
  cfg jsonb := loyalty_cfg();
begin
  if new.telegram_id is not null then
    perform loyalty_credit(new.id, (cfg ->> 'welcome_rub')::int, 'welcome', null,
      (cfg ->> 'welcome_valid_days')::int, true, null, 'system',
      format('Добро пожаловать в Клуб Алии! %s бонусов на первый заказ', cfg ->> 'welcome_rub'));
  end if;
  return null;
end $$;
create trigger loyalty_clients_after_insert after insert on clients
  for each row execute function loyalty_clients_after_insert();

update clients set referral_code = loyalty_new_referral_code() where referral_code is null;

-- Триггеры: заказы ------------------------------------------------------------

create function loyalty_orders_before_update() returns trigger language plpgsql as $$
declare
  cfg jsonb := loyalty_cfg();
  pct numeric;
  base integer;
  cashback integer;
  inv record;
begin
  -- до подтверждения клиент может поменять, сколько хочет списать; после — сумма зафиксирована
  if old.status <> 'new' then new.bonus_spent_rub := old.bonus_spent_rub; end if;
  if new.status is not distinct from old.status then return new; end if;

  -- Заказ ушёл дальше 'new': списываем бонусы (не больше потолка на момент подтверждения)
  if old.status = 'new' and new.status <> 'cancelled' and new.bonus_spent_rub > 0
     and not exists (select 1 from bonus_transactions where order_id = new.id and kind = 'redeem') then
    new.bonus_spent_rub := loyalty_debit(new.client_id,
      least(new.bonus_spent_rub, loyalty_redeem_cap(new.client_id, new.id, new.commission_rub)),
      'redeem', new.id, loyalty_is_first_order(new.client_id, new.id),
      format('Оплата заказа A-%s', lpad(new.number::text, 4, '0')));
  elsif old.status = 'new' and new.status = 'cancelled' then
    new.bonus_spent_rub := 0;
  end if;

  -- Доставлен: кэшбэк по текущему уровню и бонус пригласившей подруге
  if new.status = 'delivered' then
    new.delivered_at := coalesce(new.delivered_at, now());
    base := coalesce(new.total_rub, 0) - coalesce(new.delivery_rub, 0) - new.bonus_spent_rub;
    if not exists (select 1 from bonus_transactions where order_id = new.id and kind = 'cashback') then
      pct := ((loyalty_tier((select loyalty_tier from clients where id = new.client_id))) ->> 'cashback_pct')::numeric;
      cashback := floor(greatest(base, 0) * pct / 100)::int;
      if cashback > 0 then
        perform loyalty_credit(new.client_id, cashback, 'cashback', new.id, null, false,
          format('Кэшбэк %s%% за заказ A-%s', pct, lpad(new.number::text, 4, '0')), 'system',
          format('Заказ A-%s доставлен. Начислено %s бонусов (кэшбэк %s%%)', lpad(new.number::text, 4, '0'), cashback, pct));
        new.bonus_earned_rub := cashback;
      end if;
    end if;

    select r.* into inv from referrals r where r.invitee_id = new.client_id and r.rewarded_order_id is null;
    if found and base >= (cfg ->> 'referral_min_order_rub')::int
       and not exists (select 1 from bonus_transactions where order_id = new.id and kind = 'referral_inviter') then
      perform loyalty_credit(inv.inviter_id, (cfg ->> 'referral_inviter_rub')::int, 'referral_inviter', new.id,
        null, false, null, 'system',
        format('Ваша подруга получила первый заказ. Вам %s бонусов, спасибо!', cfg ->> 'referral_inviter_rub'));
      update referrals set rewarded_order_id = new.id where invitee_id = new.client_id;
    end if;
  end if;

  -- Отмена: вернуть списанное; если заказ был доставлен и его вернули — забрать кэшбэк
  if new.status = 'cancelled' then
    perform loyalty_refund_redeem(new.id);
    if old.status = 'delivered' and new.bonus_earned_rub > 0
       and not exists (select 1 from bonus_transactions where order_id = new.id and kind = 'cashback_reversal') then
      perform loyalty_debit(new.client_id, new.bonus_earned_rub, 'cashback_reversal', new.id, true,
        'Заказ возвращён, кэшбэк отменён');
    end if;
  end if;
  return new;
end $$;
create trigger loyalty_orders_before_update before update on orders
  for each row execute function loyalty_orders_before_update();

-- Уровень пересчитываем после записи, когда заказ уже виден как delivered/cancelled.
create function loyalty_orders_after_update() returns trigger language plpgsql as $$
begin
  if new.status is distinct from old.status and (new.status = 'delivered' or old.status = 'delivered') then
    perform loyalty_recalc_tier(new.client_id);
  end if;
  return null;
end $$;
create trigger loyalty_orders_after_update after update on orders
  for each row execute function loyalty_orders_after_update();

-- Действия (зовёт сервер / CRM / бот) ---------------------------------------

-- Привязать приглашение. Только для нового клиента без заказов; подруга получает бонус на первый заказ.
create function loyalty_register_referral(p_invitee uuid, p_code text) returns boolean language plpgsql as $$
declare
  cfg jsonb := loyalty_cfg();
  inviter uuid;
begin
  select id into inviter from clients where referral_code = upper(trim(p_code));
  if inviter is null or inviter = p_invitee then return false; end if;
  if exists (select 1 from referrals where invitee_id = p_invitee)
     or exists (select 1 from orders where client_id = p_invitee and status <> 'cancelled' and status <> 'new')
     or exists (select 1 from referrals where invitee_id = inviter and inviter_id = p_invitee) then
    return false;
  end if;
  insert into referrals (invitee_id, inviter_id) values (p_invitee, inviter);
  update clients set referred_by = inviter where id = p_invitee;
  perform loyalty_credit(p_invitee, (cfg ->> 'referral_friend_rub')::int, 'referral_friend', null,
    (cfg ->> 'welcome_valid_days')::int, true, null, 'system',
    format('Подарок от подруги: %s бонусов на первый заказ', cfg ->> 'referral_friend_rub'));
  return true;
end $$;

-- Бонус за отзыв с фото (один раз на заказ).
create function loyalty_reward_review(p_order uuid, p_created_by text) returns bigint language plpgsql as $$
declare
  o orders;
begin
  select * into o from orders where id = p_order;
  if not found then raise exception 'order % not found', p_order; end if;
  if exists (select 1 from bonus_transactions where order_id = p_order and kind = 'review') then return null; end if;
  return loyalty_credit(o.client_id, (loyalty_cfg() ->> 'review_rub')::int, 'review', p_order, null, false,
    'Отзыв с фото', p_created_by, format('Спасибо за отзыв! Начислено %s бонусов', loyalty_cfg() ->> 'review_rub'));
end $$;

-- Ручная корректировка Алией: плюс начисляет, минус списывает (не больше доступного).
create function loyalty_adjust(p_client uuid, p_amount integer, p_comment text, p_created_by text)
returns integer language plpgsql as $$
begin
  if p_comment is null or length(trim(p_comment)) = 0 then raise exception 'comment required'; end if;
  if p_amount > 0 then
    perform loyalty_credit(p_client, p_amount, 'manual', null, null, false, p_comment, p_created_by,
      format('Алия начислила вам %s бонусов: %s', p_amount, p_comment));
    return p_amount;
  end if;
  return -loyalty_debit(p_client, -p_amount, 'manual', null, true, p_comment, p_created_by);
end $$;

-- Ежедневные задачи -----------------------------------------------------------

create function loyalty_expire() returns integer language plpgsql as $$
declare
  c record;
  n integer := 0;
  warn_days integer := (loyalty_cfg() ->> 'expire_warn_days')::int;
begin
  for c in select * from bonus_transactions where remaining_rub > 0 and expires_at <= now() for update loop
    insert into bonus_transactions (client_id, amount_rub, kind, comment)
    values (c.client_id, -c.remaining_rub, 'expire', format('Сгорели бонусы от %s', to_char(c.created_at, 'DD.MM.YYYY')));
    insert into bonus_allocations (debit_id, credit_id, amount_rub) values (currval('bonus_transactions_id_seq'), c.id, c.remaining_rub);
    update bonus_transactions set remaining_rub = 0 where id = c.id;
    n := n + 1;
  end loop;

  -- Напоминание за warn_days: одно сообщение на клиента со всей суммой
  insert into loyalty_notices (client_id, kind, text)
  select client_id, 'expiring',
         format('%s бонусов сгорят %s. Успейте потратить их в заказе', sum(remaining_rub), to_char(min(expires_at), 'DD.MM'))
  from bonus_transactions
  where remaining_rub > 0 and not expiry_warned and expires_at <= now() + make_interval(days => warn_days)
  group by client_id;
  update bonus_transactions set expiry_warned = true
  where remaining_rub > 0 and not expiry_warned and expires_at <= now() + make_interval(days => warn_days);
  return n;
end $$;

-- День рождения: за birthday_days_before дней до даты, раз в год. 29 февраля в невисокосный год — 28-го.
create function loyalty_birthdays(p_today date default current_date) returns integer language plpgsql as $$
declare
  cfg jsonb := loyalty_cfg();
  target date := p_today + (cfg ->> 'birthday_days_before')::int;
  c record;
  n integer := 0;
begin
  for c in
    select id from clients
    where birthday is not null
      and (to_char(birthday, 'MM-DD') = to_char(target, 'MM-DD')
           or (to_char(birthday, 'MM-DD') = '02-29' and to_char(target, 'MM-DD') = '02-28'
               and not (extract(year from target)::int % 4 = 0
                        and (extract(year from target)::int % 100 <> 0 or extract(year from target)::int % 400 = 0))))
      and not exists (select 1 from bonus_transactions t where t.client_id = clients.id and t.kind = 'birthday'
                      and t.created_at > now() - interval '300 days')
  loop
    perform loyalty_credit(c.id, (cfg ->> 'birthday_rub')::int, 'birthday', null,
      (cfg ->> 'birthday_valid_days')::int, false, null, 'system',
      format('Скоро ваш день рождения! Дарим %s бонусов, они действуют %s дней', cfg ->> 'birthday_rub', cfg ->> 'birthday_valid_days'));
    n := n + 1;
  end loop;
  return n;
end $$;

create function loyalty_daily() returns void language plpgsql as $$
declare
  c record;
begin
  perform loyalty_expire();
  perform loyalty_birthdays();
  for c in select id from clients where loyalty_tier <> (loyalty_cfg() -> 'tiers' -> 0 ->> 'code') loop
    perform loyalty_recalc_tier(c.id);   -- старые заказы выпадают из окна
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('loyalty-daily', '0 3 * * *', 'select loyalty_daily()');  -- 03:00 UTC = 10:00 Бангкок
  end if;
end $$;

-- Сводка для кабинета, CRM и бота ------------------------------------------

create view client_bonus_balance with (security_invoker = true) as
select c.id as client_id,
       c.referral_code,
       c.loyalty_tier,
       c.tier_since,
       loyalty_tier(c.loyalty_tier) ->> 'name' as tier_name,
       (loyalty_tier(c.loyalty_tier) ->> 'cashback_pct')::numeric as cashback_pct,
       coalesce(sum(t.remaining_rub) filter (where t.expires_at > now()), 0)::int as balance_rub,
       coalesce(sum(t.remaining_rub) filter (where t.expires_at > now() and not t.only_first_order), 0)::int as balance_any_order_rub,
       coalesce(sum(t.remaining_rub) filter (
         where t.expires_at > now()
           and t.expires_at <= now() + make_interval(days => (loyalty_cfg() ->> 'expire_warn_days')::int)), 0)::int as expiring_soon_rub,
       min(t.expires_at) filter (where t.remaining_rub > 0 and t.expires_at > now()) as next_expiry,
       loyalty_spent(c.id) as spent_12m_rub
from clients c
left join bonus_transactions t on t.client_id = c.id and t.remaining_rub > 0
group by c.id;
