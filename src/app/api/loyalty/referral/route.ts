import { NextResponse } from 'next/server';
import { verifyInitData } from '@/lib/telegram';
import { parseReferralCode } from '@/lib/loyalty/rules';
import { registerReferral } from '@/lib/loyalty/server';

// POST { initData, code? } — Mini App открыт по ссылке t.me/<бот>/<app>?startapp=ref_КОД.
// Код берётся из start_param внутри подписанного initData, либо из тела запроса.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { initData?: string; code?: string } | null;
  const user = body?.initData ? verifyInitData(body.initData) : null;
  if (!user) return NextResponse.json({ error: 'Откройте магазин из Telegram' }, { status: 401 });
  const code = parseReferralCode(new URLSearchParams(body!.initData).get('start_param') ?? body?.code);
  if (!code) return NextResponse.json({ ok: false, reason: 'no_code' });
  try {
    return NextResponse.json({ ok: await registerReferral(user, code) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Не получилось применить приглашение' }, { status: 500 });
  }
}
