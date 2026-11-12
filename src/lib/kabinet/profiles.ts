import 'server-only';
import { connection } from 'next/server';
import { db } from '@/lib/supabase';
import { demoItems, demoVariants } from '@/lib/demo-data';
import type { TelegramUser } from '@/lib/telegram';
import type { CatalogItem, Variant } from '@/lib/types';
import { DEFAULT_CHARTS, matchCatalog, type Match, type Product, type SizeChartRow, type SizeProfile } from './sizing';

export class ProfileError extends Error {}

const NUM_FIELDS = ['height_cm', 'weight_kg', 'chest_cm', 'waist_cm', 'hips_cm', 'foot_cm', 'ru_size', 'jeans_waist_inch'] as const;
const ALPHA = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];

/** Профиль из браузера: только известные поля, числа в разумных пределах (те же, что в CHECK в 0002). */
export function cleanProfile(raw: unknown): SizeProfile {
  const r = (raw ?? {}) as Record<string, unknown>;
  const gender = r.gender === 'men' || r.gender === 'kids' ? r.gender : 'women';
  const fit = r.fit_preference === 'tight' || r.fit_preference === 'oversize' ? r.fit_preference : 'regular';
  const p: SizeProfile = {
    id: typeof r.id === 'string' ? r.id : '',
    label: String(r.label ?? 'Я').slice(0, 40) || 'Я',
    gender,
    fit_preference: fit,
    usual_top: ALPHA.includes(String(r.usual_top)) ? String(r.usual_top) : null,
    usual_bottom: ALPHA.includes(String(r.usual_bottom)) ? String(r.usual_bottom) : null,
    style_notes: typeof r.style_notes === 'string' ? r.style_notes.slice(0, 300) : null,
  };
  const limits: Record<(typeof NUM_FIELDS)[number], [number, number]> = {
    height_cm: [50, 230], weight_kg: [3, 250], chest_cm: [40, 170], waist_cm: [35, 170], hips_cm: [40, 180],
    foot_cm: [10, 35], ru_size: [26, 80], jeans_waist_inch: [20, 48],
  };
  for (const k of NUM_FIELDS) {
    const v = r[k] === '' || r[k] == null ? NaN : Number(r[k]);
    const [lo, hi] = limits[k];
    p[k] = Number.isFinite(v) && v >= lo && v <= hi ? (k === 'foot_cm' ? Math.round(v * 10) / 10 : Math.round(v)) : null;
  }
  return p;
}

async function clientIdFor(tgUser: TelegramUser): Promise<string> {
  const client = db();
  if (!client) throw new ProfileError('База не настроена');
  const { data } = await client.from('clients').select('id').eq('telegram_id', tgUser.id).maybeSingle();
  if (data?.id) return data.id as string;
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || null;
  const { data: created, error } = await client.from('clients')
    .insert({ telegram_id: tgUser.id, telegram_username: tgUser.username ?? null, name, source: 'telegram' })
    .select('id').single();
  if (error) throw new Error(`clients: ${error.message}`);
  return created.id as string;
}

const COLUMNS = 'id, label, is_primary, gender, height_cm, weight_kg, chest_cm, waist_cm, hips_cm, foot_cm, ru_size, usual_top, usual_bottom, jeans_waist_inch, fit_preference, style_notes';

export async function listProfiles(tgUser: TelegramUser): Promise<SizeProfile[]> {
  const clientId = await clientIdFor(tgUser);
  const { data, error } = await db()!.from('size_profiles').select(COLUMNS).eq('client_id', clientId)
    .order('is_primary', { ascending: false }).order('updated_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as SizeProfile[];
}

/** Создать или обновить профиль. Первый профиль клиента становится основным. */
export async function saveProfile(tgUser: TelegramUser, raw: unknown): Promise<SizeProfile> {
  const clientId = await clientIdFor(tgUser);
  const { id, ...fields } = cleanProfile(raw);
  const client = db()!;
  const row = { ...fields, updated_at: new Date().toISOString() };
  if (id && /^[0-9a-f-]{36}$/i.test(id)) {
    const { data, error } = await client.from('size_profiles').update(row).eq('id', id).eq('client_id', clientId).select(COLUMNS).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new ProfileError('Профиль не найден');
    return data as SizeProfile;
  }
  const { count } = await client.from('size_profiles').select('id', { count: 'exact', head: true }).eq('client_id', clientId);
  if ((count ?? 0) >= 10) throw new ProfileError('Можно сохранить до 10 профилей');
  const { data, error } = await client.from('size_profiles')
    .insert({ ...row, client_id: clientId, is_primary: !count }).select(COLUMNS).single();
  if (error) throw new Error(error.message);
  return data as SizeProfile;
}

/**
 * Удалить профиль. Фото примерки и готовые примерки удаляет модуль примерки
 * (deleteTryOnsForProfile) — подключим его здесь, когда он появится в репозитории.
 */
export async function deleteProfile(tgUser: TelegramUser, id: string): Promise<void> {
  const clientId = await clientIdFor(tgUser);
  const client = db()!;
  const { data } = await client.from('size_profiles').select('tryon_photo_path').eq('id', id).eq('client_id', clientId).maybeSingle();
  if (data?.tryon_photo_path) await client.storage.from('tryon-photos').remove([data.tryon_photo_path]);
  const { error } = await client.from('size_profiles').delete().eq('id', id).eq('client_id', clientId);
  if (error) throw new Error(error.message);
}

const MAX_PRODUCTS = 400;

/** Товары, в которых рекомендованный размер профиля есть в наличии. */
export async function matchesFor(profile: SizeProfile): Promise<{ matches: Match[]; items: Map<string, CatalogItem>; demo: boolean }> {
  await connection();
  const client = db();
  const genders = profile.gender === 'kids' ? ['kids', 'baby'] : [profile.gender, 'unisex'];
  let items: CatalogItem[], variants: Variant[], charts: SizeChartRow[] = DEFAULT_CHARTS, fits = new Map<string, string | null>();
  if (!client) {
    items = demoItems.filter((i) => i.gender && genders.includes(i.gender));
    variants = demoVariants.filter((v) => items.some((i) => i.id === v.product_id));
  } else {
    const { data, error } = await client.from('catalog_items').select('*')
      .eq('brand_id', 'uniqlo').eq('is_active', true).eq('has_stock', true).in('gender', genders)
      .order('updated_at', { ascending: false }).limit(MAX_PRODUCTS);
    if (error) throw new Error(`Каталог: ${error.message}`);
    items = (data ?? []) as CatalogItem[];
    fits = new Map(items.map((i) => [i.id, (i as CatalogItem & { fit?: string | null }).fit ?? null]));
    variants = [];
    for (let i = 0; i < items.length; i += 100) { // ограничение длины запроса
      const ids = items.slice(i, i + 100).map((x) => x.id);
      const res = await client.from('product_variants').select('*').in('product_id', ids).eq('in_stock', true);
      if (res.error) throw new Error(res.error.message);
      variants.push(...((res.data ?? []) as Variant[]));
    }
    const sc = await client.from('size_charts').select('*').eq('brand_id', 'uniqlo');
    if (!sc.error && sc.data?.length) charts = sc.data as SizeChartRow[];
  }
  const byProduct = new Map<string, Variant[]>();
  for (const v of variants) byProduct.set(v.product_id, [...(byProduct.get(v.product_id) ?? []), v]);
  const products: Product[] = items.map((i) => ({
    id: i.id, source_id: i.source_id, name_en: i.name_en, name_ru: i.name_ru,
    gender: i.gender, category: (i.category ?? null) as Product['category'], fit: (fits.get(i.id) ?? null) as Product['fit'],
    size_system: (i.size_system ?? guessSystem(byProduct.get(i.id) ?? [])) as Product['size_system'],
    variants: byProduct.get(i.id) ?? [],
  }));
  return { matches: matchCatalog(profile, products, charts), items: new Map(items.map((i) => [i.id, i])), demo: !client };
}

/** Если синхронизация не проставила size_system, угадываем по подписям размеров. */
function guessSystem(vs: Variant[]): string {
  const l = vs.map((v) => v.size_label ?? '');
  if (l.some((s) => /inch$/i.test(s))) return 'waist_inch';
  if (l.some((s) => /cm$/i.test(s))) return 'shoe_cm';
  if (l.length && l.every((s) => /^\d{2,3}$/.test(s))) return 'kids_cm';
  if (l.some((s) => /one ?size/i.test(s))) return 'one_size';
  return 'alpha';
}
