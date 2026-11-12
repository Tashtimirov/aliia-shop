// Загрузка выгрузки (out/uniqlo-th-*.json) в Supabase: products + product_variants.
// Запуск: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node load-to-supabase.mjs [папка с out]
// Товары, которых нет в свежей выгрузке, помечаются is_active=false (не удаляются: на них ссылаются заказы).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const dir = process.argv[2] || 'out';
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

// Категория по названию (в списке API её нет). Порядок важен: первое совпадение.
const RULES = [
  ['innerwear', /heattech|airism|bra\b|bralette|underwear|briefs|boxer|trunks|shorts? \(innerwear\)|camisole|socks|tights|leggings|pajama|lounge/i],
  ['outerwear', /jacket|coat|parka|down\b|puffer|vest|blouson|blazer|fleece full-zip|windbreaker|pufftech|rufftech/i],
  ['dresses', /dress|skirt dress|jumpsuit|overall/i],
  ['bottoms', /pants|jeans|trousers|chino|skirt|shorts|joggers|leggings pants|culottes/i],
  ['shoes', /shoes|sneakers|sandals|slippers|boots/i],
  ['accessories', /bag|cap|hat|beanie|scarf|stole|gloves|belt|umbrella|wallet|pouch|muffler/i],
  ['tops', /t-shirt|\bt\b|shirt|blouse|sweater|cardigan|sweatshirt|hoodie|polo|tank|top|knit|turtleneck|\but\b|bra top/i],
];
const category = (name) => RULES.find(([, re]) => re.test(name))?.[0] ?? null;

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function main() {
  const products = JSON.parse(await readFile(join(dir, 'uniqlo-th-products.json'), 'utf8'));
  const variants = JSON.parse(await readFile(join(dir, 'uniqlo-th-variants.json'), 'utf8'));
  const now = new Date().toISOString();

  const rows = products.map((p) => ({
    brand_id: 'uniqlo', source_id: p.source_id, name_en: p.name_en, gender: p.gender,
    category: p.category ?? category(p.name_en), source_url: p.source_url, images: p.images ?? [],
    size_system: p.size_system, rating: p.raw_rating ?? null, is_active: true, updated_at: now,
  }));
  const idBySource = new Map();
  for (const part of chunks(rows, 500)) {
    const { data, error } = await db.from('products').upsert(part, { onConflict: 'brand_id,source_id' }).select('id, source_id');
    if (error) throw error;
    for (const r of data) idBySource.set(r.source_id, r.id);
  }

  const seen = new Set();
  const vrows = [];
  for (const v of variants) {
    const product_id = idBySource.get(v.product_source_id);
    const k = `${product_id}|${v.color_code}|${v.size_code}`;
    if (!product_id || !v.color_code || !v.size_code || v.price_thb == null || seen.has(k)) continue;
    seen.add(k);
    vrows.push({
      product_id, sku: v.sku ?? null, color_code: v.color_code, color_name: v.color_name ?? null,
      size_code: v.size_code, size_label: v.size_label ?? null, price_thb: v.price_thb,
      base_price_thb: v.base_price_thb ?? v.price_thb, in_stock: v.in_stock ?? false,
      stock_checked_at: v.stock_checked_at ?? now, updated_at: now,
    });
  }
  for (const part of chunks(vrows, 1000)) {
    const { error } = await db.from('product_variants').upsert(part, { onConflict: 'product_id,color_code,size_code' });
    if (error) throw error;
  }

  // Варианты, которых нет в выгрузке, считаем закончившимися; товары без выгрузки скрываем
  const { error: e1 } = await db.from('product_variants').update({ in_stock: false }).lt('updated_at', now);
  if (e1) throw e1;
  const { error: e2 } = await db.from('products').update({ is_active: false }).eq('brand_id', 'uniqlo').lt('updated_at', now);
  if (e2) throw e2;

  const uncategorized = rows.filter((r) => !r.category).length;
  console.log(`Загружено: товаров ${rows.length}, вариантов ${vrows.length}, без категории ${uncategorized}`);
}

main().catch((e) => { console.error('Ошибка:', e.message ?? e); process.exit(1); });
