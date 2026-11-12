import { NextResponse } from 'next/server';
import { getPricing } from '@/lib/catalog';
import { mainImage } from '@/lib/images';
import { cardPriceRub } from '@/lib/pricing';
import { cleanProfile, matchesFor } from '@/lib/kabinet/profiles';

/** «Есть мой размер»: товары, где рекомендованный размер профиля в наличии. Тело: { profile } */
export async function POST(req: Request) {
  let body: { profile?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 });
  }
  try {
    const profile = cleanProfile(body.profile);
    const [{ matches, items, demo }, pricing] = await Promise.all([matchesFor(profile), getPricing()]);
    return NextResponse.json({
      demo,
      items: matches.slice(0, 120).map((m) => {
        const item = items.get(m.product.id)!;
        return {
          id: m.product.id,
          name: item.name_ru || item.name_en,
          category: item.category,
          image: mainImage(item, m.colorsInStock[0]?.color_code),
          size: m.advice.size,
          alternative: m.advice.alternative ?? null,
          confidence: m.advice.confidence,
          reason: m.advice.reason,
          colors: m.colorsInStock.map((c) => c.color_name || c.color_code),
          price_rub: cardPriceRub(Math.min(...m.colorsInStock.map((c) => c.price_thb)), pricing),
        };
      }),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Не получилось подобрать вещи, попробуйте ещё раз' }, { status: 500 });
  }
}
