import { NextResponse } from 'next/server';
import { getPricing } from '@/lib/catalog';
import { cardPriceRub } from '@/lib/pricing';
import { db } from '@/lib/supabase';
import { verifyInitData } from '@/lib/telegram';
import { aiEnabled, MODEL, recommend } from '@/lib/kabinet/ai';
import { cleanProfile, matchesFor } from '@/lib/kabinet/profiles';

const MAX_CANDIDATES = 80;

/**
 * ИИ-подборка из вещей, где размер клиента есть в наличии.
 * Тело: { initData, profile, request }. С настоящей базой работает только после входа через Telegram,
 * чтобы запросы к Claude не шли от кого угодно.
 */
export async function POST(req: Request) {
  let body: { initData?: string; profile?: unknown; request?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 });
  }
  if (!aiEnabled()) return NextResponse.json({ error: 'ИИ-подбор пока не включён' }, { status: 503 });
  const tgUser = body.initData ? verifyInitData(body.initData) : null;
  const client = db();
  if (client && !tgUser) return NextResponse.json({ error: 'Откройте магазин из Telegram-бота, чтобы получить подборку' }, { status: 401 });

  const profile = cleanProfile(body.profile);
  const request = typeof body.request === 'string' ? body.request.slice(0, 300) : '';
  try {
    const [{ matches, items }, pricing] = await Promise.all([matchesFor(profile), getPricing()]);
    if (!matches.length) return NextResponse.json({ summary: 'Пока нет вещей в вашем размере. Проверьте профиль или загляните позже.', picks: [] });
    const res = await recommend({
      profile, candidates: matches.slice(0, MAX_CANDIDATES), request,
      priceRub: (satang) => cardPriceRub(satang, pricing),
    });
    if (client && tgUser) {
      const { data: c } = await client.from('clients').select('id').eq('telegram_id', tgUser.id).maybeSingle();
      await client.from('ai_recommendations').insert({
        client_id: c?.id ?? null, profile_id: /^[0-9a-f-]{36}$/i.test(profile.id) ? profile.id : null, request,
        result: { summary: res.summary, picks: res.picks }, model: MODEL,
        input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens,
      });
    }
    const byId = new Map(matches.map((m) => [m.product.id, m]));
    return NextResponse.json({
      summary: res.summary,
      picks: res.picks.map((p) => {
        const m = byId.get(p.product_id)!;
        const color = m.colorsInStock.find((c) => c.color_code === p.color_code)!;
        const item = items.get(p.product_id)!;
        return {
          id: p.product_id, name: item.name_ru || item.name_en, size: p.size_label,
          color: color.color_name || color.color_code, price_rub: cardPriceRub(color.price_thb, pricing), reason: p.reason,
        };
      }),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Не получилось подобрать, попробуйте ещё раз' }, { status: 500 });
  }
}
