import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recommendSize, matchCatalog, type Product, type SizeProfile } from './sizing.ts';

const v = (size: string, inStock = true, color = '09') => ({
  id: `${color}-${size}`, color_code: color, color_name: color === '09' ? 'BLACK' : 'NATURAL',
  size_label: size, price_thb: 99000, in_stock: inStock,
});
const product = (over: Partial<Product>, sizes = ['XS', 'S', 'M', 'L', 'XL']): Product => ({
  id: 'p1', source_id: 'E000000-000', name_en: 'Test', gender: 'women', category: 'tops', fit: 'regular',
  size_system: 'alpha', variants: sizes.map((s) => v(s)), ...over,
});
const anna: SizeProfile = { id: 'a', label: 'Я', gender: 'women', chest_cm: 90, waist_cm: 70, hips_cm: 96 };

test('верх по обхвату груди', () => {
  assert.equal(recommendSize(anna, product({}))!.size, 'M');
});

test('между размерами: облегающе меньше, свободно больше', () => {
  const p: SizeProfile = { ...anna, chest_cm: 87 }; // S 79–87 и M 86–94
  assert.equal(recommendSize({ ...p, fit_preference: 'tight' }, product({}))!.size, 'S');
  const loose = recommendSize({ ...p, fit_preference: 'oversize' }, product({}))!;
  assert.equal(loose.size, 'M');
  assert.equal(loose.alternative, 'S');
  assert.equal(loose.confidence, 'medium');
});

test('свободная посадка у обычной вещи даёт размер больше, у оверсайза нет', () => {
  const p: SizeProfile = { ...anna, fit_preference: 'oversize' };
  assert.equal(recommendSize(p, product({}))!.size, 'L');
  assert.equal(recommendSize(p, product({ fit: 'oversized' }))!.size, 'M');
});

test('низ по талии и бёдрам', () => {
  assert.equal(recommendSize(anna, product({ category: 'bottoms' }))!.size, 'M');
});

test('оценка по российскому размеру даёт низкую уверенность', () => {
  const r = recommendSize({ id: 'b', label: 'Я', gender: 'women', ru_size: 44 }, product({}))!;
  assert.equal(r.size, 'M');
  assert.equal(r.confidence, 'low');
});

test('без мерок берём привычный размер', () => {
  const r = recommendSize({ id: 'c', label: 'Я', gender: 'women', usual_top: 'S' }, product({}))!;
  assert.equal(r.size, 'S');
  assert.equal(r.confidence, 'medium');
});

test('мужская вещь женскому профилю не подбирается, унисекс подбирается', () => {
  assert.equal(recommendSize(anna, product({ gender: 'men' })), null);
  assert.ok(recommendSize(anna, product({ gender: 'unisex' })));
});

test('джинсы в дюймах, обувь в см, детское по росту', () => {
  assert.equal(recommendSize({ ...anna, jeans_waist_inch: 27 }, product({ category: 'bottoms', size_system: 'waist_inch' }, ['25inch', '26inch', '27inch', '28inch']))!.size, '27inch');
  assert.equal(recommendSize({ ...anna, foot_cm: 23.7 }, product({ category: 'shoes', size_system: 'shoe_cm' }, ['23', '23.5', '24', '24.5']))!.size, '24');
  const kid: SizeProfile = { id: 'k', label: 'Дочка', gender: 'kids', height_cm: 118 };
  assert.equal(recommendSize(kid, product({ gender: 'kids', size_system: 'kids_cm' }, ['100', '110', '120', '130']))!.size, '120');
});

test('фильтр «есть мой размер» отбрасывает товары без размера в наличии', () => {
  const inStock = product({ id: 'p1' });
  const soldOut = product({ id: 'p2', variants: [v('M', false), v('L')] });
  const res = matchCatalog(anna, [inStock, soldOut]);
  assert.deepEqual(res.map((m) => m.product.id), ['p1']);
  assert.equal(res[0].colorsInStock[0].variant_id, '09-M');
});
