// Хранилище примерок на Supabase. Клиент с service_role ключом, только на сервере.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Files, Settings, Store, TryOnRow } from './tryon.ts';

const ROW = 'id, client_id, profile_id, product_id, color_code, base_result_id, photo_version, provider, status, result_path, created_at';

async function q<T>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export function supabaseStore(db: SupabaseClient): Store {
  return {
    getProfile: (id) => q(db.from('size_profiles').select('id, client_id, tryon_photo_path, tryon_consent_at, updated_at').eq('id', id).maybeSingle()),
    getProduct: (id) => q(db.from('products').select('id, category, images, is_active').eq('id', id).maybeSingle()),
    getResult: (id) => q(db.from('tryon_results').select(ROW).eq('id', id).maybeSingle()),
    async findCached(k) {
      let s = db.from('tryon_results').select(ROW)
        .eq('profile_id', k.profileId).eq('product_id', k.productId).eq('color_code', k.colorCode)
        .eq('photo_version', k.photoVersion).neq('status', 'failed');
      s = k.baseResultId ? s.eq('base_result_id', k.baseResultId) : s.is('base_result_id', null);
      return q(s.maybeSingle());
    },
    async countToday(clientId, since) {
      const { count, error } = await db.from('tryon_results').select('id', { count: 'exact', head: true })
        .eq('client_id', clientId).neq('status', 'failed').gte('created_at', since);
      if (error) throw error;
      return count ?? 0;
    },
    async isVip(clientId) {
      const c = await q<{ loyalty_tier?: string } | null>(db.from('clients').select('loyalty_tier').eq('id', clientId).maybeSingle());
      return c?.loyalty_tier === 'friend' || c?.loyalty_tier === 'vip';
    },
    insertPending: (row) => q<TryOnRow>(db.from('tryon_results').insert(row).select(ROW).single()),
    async markDone(id, result_path, cost_usd, provider) {
      await q(db.from('tryon_results').update({ status: 'done', result_path, cost_usd, provider }).eq('id', id));
    },
    async markFailed(id, error) {
      await q(db.from('tryon_results').update({ status: 'failed', error: error.slice(0, 1000) }).eq('id', id));
    },
  };
}

export function supabaseFiles(db: SupabaseClient, fetchFn: typeof fetch = fetch): Files {
  const sign = async (bucket: string, path: string) => {
    const { data, error } = await db.storage.from(bucket).createSignedUrl(path, 600); // 10 минут
    if (error) throw error;
    return data.signedUrl;
  };
  return {
    signedPhotoUrl: (path) => sign('tryon-photos', path),
    signedResultUrl: (path) => sign('tryon-results', path),
    async saveResult(path, fromUrl) {
      const res = await fetchFn(fromUrl);
      if (!res.ok) throw new Error(`скачивание результата: HTTP ${res.status}`);
      const { error } = await db.storage.from('tryon-results')
        .upload(path, await res.arrayBuffer(), { contentType: res.headers.get('content-type') ?? 'image/jpeg', upsert: true });
      if (error) throw error;
    },
  };
}

export async function loadSettings(db: SupabaseClient): Promise<Settings & { mode?: 'performance' | 'balanced' | 'quality' }> {
  const row = await q<{ value: Partial<Settings & { mode: 'performance' | 'balanced' | 'quality' }> } | null>(db.from('settings').select('value').eq('key', 'tryon').maybeSingle());
  return { provider: 'fashn', daily_limit: 10, ...(row?.value ?? {}) };
}

/** Клиент удалил фото или профиль: стереть все его примерки этого профиля (файлы и строки). */
export async function deleteTryOnsForProfile(db: SupabaseClient, profileId: string): Promise<number> {
  const rows = await q<{ id: string; result_path: string | null }[]>(
    db.from('tryon_results').select('id, result_path').eq('profile_id', profileId));
  const paths = rows.map((r) => r.result_path).filter((p): p is string => !!p);
  if (paths.length) {
    const { error } = await db.storage.from('tryon-results').remove(paths);
    if (error) throw error;
  }
  await q(db.from('tryon_results').delete().eq('profile_id', profileId));
  return rows.length;
}
