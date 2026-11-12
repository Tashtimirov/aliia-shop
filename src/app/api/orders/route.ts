import { NextResponse } from 'next/server';
import { createOrder, OrderError, orderNumber, type OrderInput } from '@/lib/orders';
import { verifyInitData } from '@/lib/telegram';

export async function POST(req: Request) {
  let body: OrderInput & { initData?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 });
  }
  const tgUser = body.initData ? verifyInitData(body.initData) : null;
  if (body.initData && !tgUser) return NextResponse.json({ error: 'Не удалось проверить вход через Telegram, откройте магазин заново из бота' }, { status: 401 });
  try {
    const res = await createOrder(
      { lines: Array.isArray(body.lines) ? body.lines : [], contact: body.contact ?? {}, source: tgUser ? 'miniapp' : 'site' },
      tgUser,
    );
    return NextResponse.json({ ...res, label: res.demo ? 'демо' : orderNumber(res.number) });
  } catch (e) {
    if (e instanceof OrderError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: 'Не получилось оформить заказ, попробуйте ещё раз или напишите Алие' }, { status: 500 });
  }
}
