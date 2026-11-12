// Виртуальная примерка по фото. Логика: src/lib/try-on/tryon.ts.
// POST {initData, profile_id, product_id, color_code, base_result_id?} -> {id, image_url, cached, left_today}
import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { verifyInitData } from '@/lib/telegram';
import { fashn, kling } from '@/lib/try-on/providers.ts';
import { orderProviders, tryOn, TryOnError, type TryOnErrorCode } from '@/lib/try-on/tryon.ts';
import { loadSettings, supabaseFiles, supabaseStore } from '@/lib/try-on/supabaseStore.ts';

export const maxDuration = 120; // FASHN обычно 10–20 с, запасной провайдер дольше

const HTTP: Record<TryOnErrorCode, number> = {
  no_photo: 409, no_consent: 409, not_found: 404, forbidden: 403, not_wearable: 422, no_image: 422, limit: 429, failed: 502,
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { initData, profile_id, product_id, color_code, base_result_id } = body ?? {};
  if (typeof profile_id !== 'string' || typeof product_id !== 'string' || typeof color_code !== 'string')
    return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 });

  const tgUser = typeof initData === 'string' ? verifyInitData(initData) : null;
  if (!tgUser) return NextResponse.json({ error: 'Откройте магазин из Телеграм-бота, чтобы примерить' }, { status: 401 });

  const client = db();
  const key = process.env.FAL_KEY;
  if (!client || !key) return NextResponse.json({ error: 'Примерка пока не подключена' }, { status: 503 });

  const { data: c } = await client.from('clients').select('id').eq('telegram_id', tgUser.id).maybeSingle();
  if (!c) return NextResponse.json({ error: 'Загрузите фото в личном кабинете', code: 'no_photo' }, { status: 409 });

  const settings = await loadSettings(client);
  try {
    const r = await tryOn(
      { clientId: c.id, profileId: profile_id, productId: product_id, colorCode: color_code, baseResultId: typeof base_result_id === 'string' ? base_result_id : null },
      { store: supabaseStore(client), files: supabaseFiles(client), providers: orderProviders([fashn(key, settings.mode), kling(key)], settings.provider), settings },
    );
    return NextResponse.json({ id: r.id, image_url: r.imageUrl, cached: r.cached, left_today: r.leftToday });
  } catch (e) {
    if (e instanceof TryOnError) return NextResponse.json({ error: e.message, code: e.code }, { status: HTTP[e.code] });
    console.error('try-on', e);
    return NextResponse.json({ error: 'Не получилось примерить, попробуйте ещё раз' }, { status: 500 });
  }
}
