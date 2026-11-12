import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashbackRub, maxRedeemRub, nextTier, parseReferralCode, referralLink, tierByCode } from './rules.ts';

test('кэшбэк округляется вниз, как в базе', () => {
  assert.equal(cashbackRub(9250, 3), 277);
  assert.equal(cashbackRub(10000, 5), 500);
  assert.equal(cashbackRub(-100, 5), 0);
});

test('списать можно до 50% комиссии и не больше баланса', () => {
  assert.equal(maxRedeemRub(1500, 2000), 750);
  assert.equal(maxRedeemRub(1500, 300), 300);
  assert.equal(maxRedeemRub(0, 300), 0);
});

test('прогресс до следующего уровня', () => {
  assert.deepEqual(nextTier('new', 12000)?.leftRub, 18000);
  assert.equal(nextTier('new', 15000)?.progress, 0.5);
  assert.equal(nextTier('friend', 40000)?.tier.code, 'vip');
  assert.equal(nextTier('vip', 500000), null);
  assert.equal(tierByCode('unknown').code, 'new');
});

test('реферальный код из ссылки', () => {
  assert.equal(parseReferralCode('ref_abc234'), 'ABC234');
  assert.equal(parseReferralCode('ABC234'), 'ABC234');
  assert.equal(parseReferralCode('ref_'), null);
  assert.equal(parseReferralCode('ref_ABC234; drop'), null);
  assert.equal(referralLink('@AliiaShopBot', 'ABC234'), 'https://t.me/AliiaShopBot?start=ref_ABC234');
});
