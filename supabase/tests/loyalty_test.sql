-- Сценарии бонусной программы. Запуск: scripts/test-db.sh (поднимает чистую базу, применяет миграции, гоняет тесты).
\set ON_ERROR_STOP on
set client_min_messages = warning;

create function pg_temp.eq(actual anyelement, expected anyelement, what text) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % — ожидали %, получили %', what, expected, actual;
  end if;
  raise notice 'ok: %', what;
end $$;

create function pg_temp.balance(p_client uuid) returns int language sql as $$
  select balance_rub from client_bonus_balance where client_id = p_client
$$;

create function pg_temp.invariant(p_client uuid) returns void language plpgsql as $$
declare a int; r int;
begin
  select coalesce(sum(amount_rub), 0), coalesce(sum(remaining_rub), 0) into a, r from bonus_transactions where client_id = p_client;
  perform pg_temp.eq(a, r, 'инвариант: сумма движений = сумма остатков');
end $$;

-- Заказ на p_total ₽ с комиссией p_commission
create function pg_temp.new_order(p_client uuid, p_total int, p_commission int, p_spend int default 0) returns uuid language sql as $$
  insert into orders (client_id, total_rub, commission_rub, delivery_rub, bonus_spent_rub)
  values (p_client, p_total, p_commission, 0, p_spend) returning id
$$;

do $$
declare
  anna uuid; bella uuid; manual uuid; o1 uuid; o2 uuid; o3 uuid; o4 uuid; n int; code text;
begin
  -- 1. Приветственные бонусы и реферальный код
  insert into clients (telegram_id, name) values (1001, 'Анна') returning id, referral_code into anna, code;
  perform pg_temp.eq(length(code), 6, 'реферальный код из 6 символов');
  perform pg_temp.eq(pg_temp.balance(anna), 300, 'приветственные 300 ₽');
  insert into clients (name, source) values ('Ручная', 'manual') returning id into manual;
  perform pg_temp.eq(pg_temp.balance(manual), 0, 'клиенту, заведённому вручную, приветственных нет');

  -- 2. Подруга по ссылке Анны
  insert into clients (telegram_id, name) values (1002, 'Белла') returning id into bella;
  perform pg_temp.eq(loyalty_register_referral(bella, lower(code)), true, 'приглашение принято');
  perform pg_temp.eq(loyalty_register_referral(bella, code), false, 'второй раз не принимается');
  perform pg_temp.eq(loyalty_register_referral(anna, (select referral_code from clients where id = bella)), false,
                     'встречное приглашение не принимается');
  perform pg_temp.eq(pg_temp.balance(bella), 800, 'у Беллы 300 приветственных + 500 от подруги');

  -- 3. Потолок списания: 50% комиссии
  o1 := pg_temp.new_order(bella, 10000, 1500, 2000);
  perform pg_temp.eq(loyalty_max_redeem(o1), 750, 'потолок 50% от комиссии 1 500 ₽');
  update orders set status = 'confirmed' where id = o1;
  perform pg_temp.eq((select bonus_spent_rub from orders where id = o1), 750, 'списано 750 из запрошенных 2 000');
  perform pg_temp.eq(pg_temp.balance(bella), 50, 'осталось 50');
  update orders set bonus_spent_rub = 0 where id = o1;
  perform pg_temp.eq((select bonus_spent_rub from orders where id = o1), 750, 'после подтверждения сумму списания не изменить');
  perform pg_temp.invariant(bella);

  -- 4. Доставка: кэшбэк 3% от (10 000 − 750) и бонус Анне за подругу
  update orders set status = 'paid' where id = o1;
  update orders set status = 'delivered' where id = o1;
  perform pg_temp.eq((select bonus_earned_rub from orders where id = o1), 277, 'кэшбэк 3% от 9 250 = 277');
  perform pg_temp.eq(pg_temp.balance(anna), 800, 'Анне +500 за подругу');
  perform pg_temp.eq((select rewarded_order_id from referrals where invitee_id = bella), o1, 'реферал отмечен выданным');
  update orders set status = 'delivered', comment = 'повторно' where id = o1;
  perform pg_temp.eq((select count(*)::int from bonus_transactions where order_id = o1 and kind = 'cashback'), 1,
                     'повторное сохранение не начисляет второй раз');

  -- 5. Остаток приветственных (50) после первого заказа больше не тратится
  o2 := pg_temp.new_order(bella, 40000, 6000, 5000);
  perform pg_temp.eq(loyalty_max_redeem(o2), 277, 'на втором заказе доступен только кэшбэк');

  -- 6. Уровень «Подруга» после 30 000 ₽ покупок
  update orders set bonus_spent_rub = 0 where id = o2;
  update orders set status = 'confirmed' where id = o2;
  update orders set status = 'delivered' where id = o2;
  perform pg_temp.eq((select bonus_earned_rub from orders where id = o2), 1200, 'кэшбэк 3% по уровню до этого заказа');
  perform pg_temp.eq((select loyalty_tier from clients where id = bella), 'friend', 'Белла стала Подругой (49 250 ₽)');
  perform pg_temp.eq((select count(*)::int from loyalty_notices where client_id = bella and kind = 'tier_up'), 1, 'уведомление о новом уровне');
  o3 := pg_temp.new_order(bella, 10000, 1500);
  update orders set status = 'confirmed' where id = o3;
  update orders set status = 'delivered' where id = o3;
  perform pg_temp.eq((select bonus_earned_rub from orders where id = o3), 500, 'кэшбэк Подруги 5%');

  -- 7. Отмена: бонусы возвращаются в те же начисления
  o4 := pg_temp.new_order(bella, 8000, 1200, 600);
  update orders set status = 'confirmed' where id = o4;
  perform pg_temp.eq((select bonus_spent_rub from orders where id = o4), 600, 'списано 600');
  n := pg_temp.balance(bella);
  update orders set status = 'cancelled' where id = o4;
  perform pg_temp.eq(pg_temp.balance(bella), n + 600, 'после отмены 600 вернулись');
  perform pg_temp.invariant(bella);

  -- 8. Возврат доставленного заказа забирает кэшбэк
  n := pg_temp.balance(bella);
  update orders set status = 'cancelled' where id = o3;
  perform pg_temp.eq(pg_temp.balance(bella), n - 500, 'кэшбэк за возвращённый заказ списан');
  perform pg_temp.invariant(bella);

  -- 9. Отзыв, ручные начисления
  perform loyalty_reward_review(o1, 'admin:1');
  perform pg_temp.eq(loyalty_reward_review(o1, 'admin:1'), null::bigint, 'за отзыв к заказу только один раз');
  n := pg_temp.balance(anna);
  perform pg_temp.eq(loyalty_adjust(anna, -100000, 'проверка', 'admin:1'), -n, 'ручное списание не больше баланса');
  perform pg_temp.eq(pg_temp.balance(anna), 0, 'баланс 0');
  perform loyalty_adjust(anna, 150, 'извинение за задержку', 'admin:1');
  perform pg_temp.eq(pg_temp.balance(anna), 150, 'ручное начисление');
  perform pg_temp.invariant(anna);

  -- 10. Сгорание и напоминание
  update bonus_transactions set expires_at = now() + interval '5 days' where client_id = anna and kind = 'manual';
  perform loyalty_expire();
  perform pg_temp.eq((select count(*)::int from loyalty_notices where client_id = anna and kind = 'expiring'), 1, 'напоминание о сгорании');
  perform loyalty_expire();
  perform pg_temp.eq((select count(*)::int from loyalty_notices where client_id = anna and kind = 'expiring'), 1, 'напоминание не повторяется');
  update bonus_transactions set expires_at = now() - interval '1 second' where client_id = anna and kind = 'manual';
  perform pg_temp.eq(loyalty_expire(), 1, 'одно начисление сгорело');
  perform pg_temp.eq((select coalesce(sum(amount_rub), 0)::int from bonus_transactions where client_id = anna), 0, 'журнал Анны в нуле');
  perform pg_temp.invariant(anna);

  -- 11. День рождения за 7 дней, раз в год, 29 февраля
  update clients set birthday = '1990-03-10' where id = anna;
  perform pg_temp.eq(loyalty_birthdays('2027-03-03'), 1, 'ДР за 7 дней');
  perform pg_temp.eq(loyalty_birthdays('2027-03-03'), 0, 'ДР не дважды');
  update clients set birthday = '1992-02-29' where id = manual;
  perform pg_temp.eq(loyalty_birthdays('2027-02-21'), 1, '29.02 в невисокосный год поздравляем 28-го');

  -- 12. Понижение уровня не раньше, чем через 3 месяца
  update orders set delivered_at = now() - interval '13 months' where client_id = bella;
  perform pg_temp.eq(loyalty_recalc_tier(bella), 'friend', 'сразу не понижаем');
  update clients set tier_since = now() - interval '4 months' where id = bella;
  perform loyalty_daily();
  perform pg_temp.eq((select loyalty_tier from clients where id = bella), 'new', 'через 3 месяца понизили');
end $$;

\echo 'loyalty: все проверки прошли'
