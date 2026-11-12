import 'server-only';
import { connection } from 'next/server';
import { db } from './supabase';
import { demoItems, demoVariants } from './demo-data';
import { DEFAULT_PRICING } from './pricing';
import type { CatalogItem, Pricing, Variant } from './types';

export type CatalogFilters = {
  q?: string;
  gender?: string;
  category?: string;
  sale?: boolean;
  page?: number;
};

export const PAGE_SIZE = 24;

export const GENDERS: Record<string, string> = { women: 'Женское', men: 'Мужское', unisex: 'Унисекс', kids: 'Детское', baby: 'Малыши' };
export const CATEGORIES: Record<string, string> = {
  outerwear: 'Верхняя одежда', tops: 'Верх', bottoms: 'Брюки и юбки', dresses: 'Платья',
  innerwear: 'Бельё и Heattech', shoes: 'Обувь', accessories: 'Аксессуары',
};

export async function listCatalog(f: CatalogFilters): Promise<{ items: CatalogItem[]; total: number; demo: boolean }> {
  const page = Math.max(1, f.page ?? 1);
  await connection(); // данные из базы всегда свежие, не запекаются при сборке
  const client = db();
  if (!client) {
    let items = demoItems;
    if (f.gender) items = items.filter((i) => i.gender === f.gender);
    if (f.category) items = items.filter((i) => i.category === f.category);
    if (f.sale) items = items.filter((i) => i.on_sale);
    if (f.q) items = items.filter((i) => i.name_en.toLowerCase().includes(f.q!.toLowerCase()));
    return { items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: items.length, demo: true };
  }
  let query = client
    .from('catalog_items')
    .select('*', { count: 'exact' })
    .eq('brand_id', 'uniqlo')
    .eq('is_active', true)
    .eq('has_stock', true);
  if (f.gender) query = query.eq('gender', f.gender);
  if (f.category) query = query.eq('category', f.category);
  if (f.sale) query = query.eq('on_sale', true);
  if (f.q) query = query.or(`name_en.ilike.%${f.q.replace(/[%,()]/g, ' ')}%,name_ru.ilike.%${f.q.replace(/[%,()]/g, ' ')}%,source_id.ilike.%${f.q.replace(/[%,()]/g, ' ')}%`);
  const { data, count, error } = await query
    .order('on_sale', { ascending: false })
    .order('updated_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw new Error(`Каталог: ${error.message}`);
  return { items: (data ?? []) as CatalogItem[], total: count ?? 0, demo: false };
}

export async function getProduct(id: string): Promise<{ item: CatalogItem; variants: Variant[] } | null> {
  await connection(); // данные из базы всегда свежие, не запекаются при сборке
  const client = db();
  if (!client) {
    const item = demoItems.find((i) => i.id === id);
    return item ? { item, variants: demoVariants.filter((v) => v.product_id === id) } : null;
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [{ data: item }, { data: variants }] = await Promise.all([
    client.from('catalog_items').select('*').eq('id', id).maybeSingle(),
    client.from('product_variants').select('*').eq('product_id', id).order('color_code').order('size_code'),
  ]);
  return item ? { item: item as CatalogItem, variants: (variants ?? []) as Variant[] } : null;
}

export async function getVariants(ids: string[]): Promise<Variant[]> {
  await connection(); // данные из базы всегда свежие, не запекаются при сборке
  const client = db();
  if (!client) return demoVariants.filter((v) => ids.includes(v.id));
  const { data, error } = await client.from('product_variants').select('*').in('id', ids);
  if (error) throw new Error(error.message);
  return (data ?? []) as Variant[];
}

export async function getPricing(): Promise<Pricing> {
  await connection(); // данные из базы всегда свежие, не запекаются при сборке
  const client = db();
  if (!client) return DEFAULT_PRICING;
  const { data } = await client.from('settings').select('value').eq('key', 'pricing').maybeSingle();
  return { ...DEFAULT_PRICING, ...(data?.value ?? {}) };
}

export { mainImage } from './images';
