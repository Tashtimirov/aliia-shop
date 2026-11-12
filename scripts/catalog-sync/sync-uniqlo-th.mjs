// Выгрузка каталога Uniqlo Таиланд в JSON (формат = shared/data-model.md: products + product_variants).
// Запуск: node sync-uniqlo-th.mjs [--limit 200] [--no-stock]
// Нужен Node 18+. Без зависимостей. Результат: out/uniqlo-th-products.json, out/uniqlo-th-variants.json
// Проверено 2026-11-12 на Mac: 1300 товаров, 18 040 вариантов за 22 мин. client id uq.th.web-spa работает.

import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://www.uniqlo.com/th/api/commerce/v5/en';
const HEADERS = {
  'x-fr-clientid': process.env.UQ_CLIENT_ID || 'uq.th.web-spa',
  'accept': 'application/json',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36',
};
const args = process.argv.slice(2);
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || Infinity;
const WITH_STOCK = !args.includes('--no-stock');
const PAGE = 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    const res = await fetch(url, { headers: HEADERS });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.status === 'ok') return body.result;
    if (i >= tries) throw new Error(`${res.status} ${url} ${JSON.stringify(body?.error ?? body)?.slice(0, 300)}`);
    await sleep(1000 * i);
  }
}

const toSatang = (v) => (v == null ? null : Math.round(Number(v) * 100));

function gender(item) {
  const g = (item.genderCategory || item.genderName || '').toLowerCase();
  if (g.includes('women')) return 'women';
  if (g.includes('men')) return 'men';
  if (g.includes('baby')) return 'baby';
  if (g.includes('kid')) return 'kids';
  if (g.includes('unisex')) return 'unisex';
  return g || null;
}

function sizeSystem(labels) {
  if (!labels.length) return null;
  if (labels.every((l) => /^(XXS|XS|S|M|L|XL|XXL|[2-4]XL)$/i.test(l))) return 'alpha';
  if (labels.every((l) => /^(ONE ?SIZE|FREE|OS)$/i.test(l))) return 'one_size';
  if (labels.every((l) => /^\d{2}(\s?inch)?$/i.test(l))) return 'waist_inch';
  if (labels.every((l) => /^\d{2}(\.5)?(\s?cm)?$/i.test(l))) return 'shoe_cm';
  if (labels.every((l) => /^\d{2,3}(\s?cm)?$/i.test(l))) return 'kids_cm';
  return 'alpha';
}

function images(item) {
  const out = [];
  for (const [colorCode, v] of Object.entries(item.images?.main ?? {})) if (v?.image) out.push({ url: v.image, color_code: colorCode, kind: 'main' });
  for (const v of item.images?.sub ?? []) if (v?.image) out.push({ url: v.image, color_code: null, kind: 'detail' });
  return out;
}

async function main() {
  const products = [], variants = [], names = new Map();
  let offset = 0, total = Infinity;
  while (offset < total && products.length < LIMIT) {
    const r = await get(`${BASE}/products?offset=${offset}&limit=${PAGE}&httpFailure=true`);
    total = r.pagination?.total ?? 0;
    for (const it of r.items ?? []) {
      if (products.length >= LIMIT) break;
      const colors = it.colors ?? [], sizes = it.sizes ?? [];
      const sizeLabels = sizes.map((s) => s.name);
      names.set(it.productId, { c: Object.fromEntries(colors.map((c) => [c.displayCode, c.name])), s: Object.fromEntries(sizes.map((x) => [x.displayCode, x.name])) });
      const base = toSatang(it.prices?.base?.value), promo = toSatang(it.prices?.promo?.value);
      products.push({
        brand_id: 'uniqlo',
        source_id: it.productId,
        name_en: it.name,
        gender: gender(it),
        category: null, // заполняется маппингом категорий на следующем шаге
        source_url: `https://www.uniqlo.com/th/en/products/${it.productId}/${it.priceGroup ?? '00'}`,
        images: images(it),
        size_system: sizeSystem(sizeLabels),
        price_group: it.priceGroup ?? '00',
        raw_rating: it.rating?.average ?? null,
      });
      // Без детального запроса: все сочетания цвет×размер, наличие неизвестно
      if (!WITH_STOCK) for (const c of colors) for (const s of sizes) variants.push({
        product_source_id: it.productId, color_code: c.displayCode, color_name: c.name,
        size_code: s.code, size_label: s.name, price_thb: promo ?? base, base_price_thb: base, in_stock: null,
      });
    }
    offset += PAGE;
    process.stderr.write(`список: ${products.length}/${Math.min(total, LIMIT)}\n`);
    await sleep(300);
  }

  if (WITH_STOCK) {
    let n = 0;
    for (const p of products) {
      try {
        const r = await get(`${BASE}/products/${p.source_id}/price-groups/${p.price_group}/l2s?withPrices=true&withStocks=true&httpFailure=true`);
        for (const l2 of r.l2s ?? []) {
          const price = r.prices?.[l2.l2Id], stock = r.stocks?.[l2.l2Id], nm = names.get(p.source_id);
          variants.push({
            product_source_id: p.source_id,
            sku: l2.l2Id,
            color_code: l2.color?.displayCode, color_name: l2.color?.name ?? nm?.c[l2.color?.displayCode] ?? null,
            size_code: l2.size?.displayCode ?? l2.size?.code, size_label: l2.size?.name ?? nm?.s[l2.size?.displayCode] ?? null,
            price_thb: toSatang(price?.promo?.value ?? price?.base?.value),
            base_price_thb: toSatang(price?.base?.value),
            in_stock: stock ? stock.statusCode !== 'STOCK_OUT' && (stock.quantity ?? 1) > 0 : null,
            stock_checked_at: new Date().toISOString(),
          });
        }
      } catch (e) { process.stderr.write(`пропуск ${p.source_id}: ${e.message}\n`); }
      if (++n % 50 === 0) process.stderr.write(`наличие: ${n}/${products.length}\n`);
      await sleep(250);
    }
  }

  await mkdir('out', { recursive: true });
  await writeFile('out/uniqlo-th-products.json', JSON.stringify(products, null, 1));
  await writeFile('out/uniqlo-th-variants.json', JSON.stringify(variants, null, 1));
  console.log(`Готово: товаров ${products.length}, вариантов ${variants.length}, в каталоге всего ${total}`);
}

main().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
