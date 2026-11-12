import { NextResponse } from 'next/server';
import { verifyInitData } from '@/lib/telegram';
import { getLoyaltySummary } from '@/lib/loyalty/server';

// POST { initData } → баланс, уровень, прогресс, история, реферальная ссылка.
// POST, а не GET: initData не должен оседать в логах и истории как часть URL.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { initData?: string } | null;
  const user = body?.initData ? verifyInitData(body.initData) : null;
  if (!user) return NextResponse.json({ error: 'Откройте магазин из Telegram, чтобы увидеть бонусы' }, { status: 401 });
  try {
    const summary = await getLoyaltySummary(user);
    return NextResponse.json(summary ?? { empty: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Не получилось загрузить бонусы' }, { status: 500 });
  }
}
