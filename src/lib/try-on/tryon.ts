// Логика примерки по фото: выбор фото товара, кэш, дневной лимит, запасной провайдер.
// Хранилище и провайдеры передаются снаружи, поэтому логика тестируется без сети.
import type { GarmentCategory, TryOnProvider } from './providers.ts';

export interface ProductImage { url: string; color_code?: string | null; kind: 'main' | 'model' | 'flat' | 'detail' }
export interface Product { id: string; category: string | null; images: ProductImage[]; is_active: boolean }
export interface Profile { id: string; client_id: string; tryon_photo_path: string | null; tryon_consent_at: string | null; updated_at: string }
export interface TryOnRow {
  id: string; client_id: string; profile_id: string; product_id: string; color_code: string;
  base_result_id: string | null; photo_version: string; provider: string;
  status: 'pending' | 'done' | 'failed'; result_path: string | null; created_at: string;
}
export interface Settings { provider: 'fashn' | 'kling'; daily_limit: number; daily_limit_vip?: number }

export interface Store {
  getProfile(profileId: string): Promise<Profile | null>;
  getProduct(productId: string): Promise<Product | null>;
  getResult(id: string): Promise<TryOnRow | null>;
  findCached(key: CacheKey): Promise<TryOnRow | null>;
  countToday(clientId: string, sinceIso: string): Promise<number>;
  isVip(clientId: string): Promise<boolean>;
  insertPending(row: Omit<TryOnRow, 'id' | 'status' | 'result_path' | 'created_at'>): Promise<TryOnRow>;
  markDone(id: string, resultPath: string, costUsd: number, provider: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}
export interface Files {
  signedPhotoUrl(path: string): Promise<string>;               // bucket tryon-photos
  saveResult(path: string, fromUrl: string): Promise<void>;    // скачать у fal и положить в tryon-results
  signedResultUrl(path: string): Promise<string>;
}
export interface CacheKey { profileId: string; productId: string; colorCode: string; photoVersion: string; baseResultId: string | null }

export type TryOnErrorCode = 'no_photo' | 'no_consent' | 'not_found' | 'forbidden' | 'not_wearable' | 'no_image' | 'limit' | 'failed';
export class TryOnError extends Error {
  code: TryOnErrorCode;
  constructor(code: TryOnErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const CATEGORY: Record<string, GarmentCategory | null> = {
  tops: 'tops', outerwear: 'tops', innerwear: 'tops',
  bottoms: 'bottoms', dresses: 'one-pieces',
  shoes: null, accessories: null,
};

export function garmentCategory(category: string | null): GarmentCategory | null {
  if (!category) return 'auto';
  return category in CATEGORY ? CATEGORY[category] : 'auto';
}

/** Фото товара нужного цвета: сначала флэтлэй, потом главное, потом на модели. */
export function pickGarmentImage(images: ProductImage[], colorCode: string): { url: string; type: 'flat-lay' | 'model' | 'auto' } | null {
  const order: ProductImage['kind'][] = ['flat', 'main', 'model'];
  const sameColor = images.filter((i) => i.color_code === colorCode);
  const anyColor = images.filter((i) => !i.color_code);
  for (const pool of [sameColor, anyColor]) {
    for (const kind of order) {
      const img = pool.find((i) => i.kind === kind);
      if (img) return { url: img.url, type: kind === 'flat' ? 'flat-lay' : kind === 'model' ? 'model' : 'auto' };
    }
  }
  return null;
}

/** Начало «сегодня» по Бангкоку (UTC+7), чтобы лимит обнулялся в полночь у Алии. */
export function dayStartIso(now: Date): string {
  const bkk = new Date(now.getTime() + 7 * 3600_000);
  bkk.setUTCHours(0, 0, 0, 0);
  return new Date(bkk.getTime() - 7 * 3600_000).toISOString();
}

export interface TryOnInput { clientId: string; profileId: string; productId: string; colorCode: string; baseResultId?: string | null }
export interface TryOnOutput { id: string; imageUrl: string; cached: boolean; leftToday: number }

export async function tryOn(
  input: TryOnInput,
  deps: { store: Store; files: Files; providers: TryOnProvider[]; settings: Settings; now?: Date },
): Promise<TryOnOutput> {
  const { store, files, providers, settings } = deps;
  const now = deps.now ?? new Date();

  const profile = await store.getProfile(input.profileId);
  if (!profile || profile.client_id !== input.clientId) throw new TryOnError('forbidden', 'Профиль не найден');
  if (!profile.tryon_photo_path) throw new TryOnError('no_photo', 'Загрузите фото в полный рост в личном кабинете');
  if (!profile.tryon_consent_at) throw new TryOnError('no_consent', 'Нужно согласие на обработку фото');

  const product = await store.getProduct(input.productId);
  if (!product || !product.is_active) throw new TryOnError('not_found', 'Товар не найден');
  const category = garmentCategory(product.category);
  if (!category) throw new TryOnError('not_wearable', 'Эту вещь пока нельзя примерить');
  const garment = pickGarmentImage(product.images, input.colorCode);
  if (!garment) throw new TryOnError('no_image', 'Нет подходящего фото товара для примерки');

  let personPath = profile.tryon_photo_path;
  let personIsPhoto = true;
  if (input.baseResultId) {
    const base = await store.getResult(input.baseResultId);
    if (!base || base.client_id !== input.clientId || base.profile_id !== profile.id || base.status !== 'done' || !base.result_path)
      throw new TryOnError('forbidden', 'Прошлая примерка не найдена');
    personPath = base.result_path;
    personIsPhoto = false;
  }

  const key: CacheKey = { profileId: profile.id, productId: product.id, colorCode: input.colorCode, photoVersion: profile.updated_at, baseResultId: input.baseResultId ?? null };
  const vip = await store.isVip(input.clientId);
  const limit = vip ? settings.daily_limit_vip ?? settings.daily_limit : settings.daily_limit;
  const used = await store.countToday(input.clientId, dayStartIso(now));

  const cached = await store.findCached(key);
  if (cached?.status === 'done' && cached.result_path)
    return { id: cached.id, imageUrl: await files.signedResultUrl(cached.result_path), cached: true, leftToday: Math.max(0, limit - used) };
  if (cached?.status === 'pending') throw new TryOnError('failed', 'Примерка уже готовится, подождите несколько секунд');

  if (used >= limit) throw new TryOnError('limit', `На сегодня примерки закончились (${limit} в день). Завтра будут снова`);

  const row = await store.insertPending({
    client_id: input.clientId, profile_id: profile.id, product_id: product.id, color_code: input.colorCode,
    base_result_id: key.baseResultId, photo_version: key.photoVersion, provider: providers[0].name,
  });

  const personImageUrl = personIsPhoto ? await files.signedPhotoUrl(personPath) : await files.signedResultUrl(personPath);
  let lastError = '';
  for (const p of providers) {
    try {
      const { imageUrl } = await p.run({ personImageUrl, garmentImageUrl: garment.url, category, garmentPhotoType: garment.type });
      const path = `${input.clientId}/${row.id}.jpg`;
      await files.saveResult(path, imageUrl);
      await store.markDone(row.id, path, p.costUsd, p.name);
      return { id: row.id, imageUrl: await files.signedResultUrl(path), cached: false, leftToday: Math.max(0, limit - used - 1) };
    } catch (e) {
      lastError = `${p.name}: ${(e as Error).message}`;
    }
  }
  await store.markFailed(row.id, lastError);
  throw new TryOnError('failed', 'Не получилось примерить, попробуйте ещё раз');
}

/** Провайдеры по порядку: выбранный в настройках первым, второй как запасной. */
export function orderProviders(all: TryOnProvider[], preferred: string): TryOnProvider[] {
  return [...all].sort((a, b) => (a.name === preferred ? -1 : b.name === preferred ? 1 : 0));
}
