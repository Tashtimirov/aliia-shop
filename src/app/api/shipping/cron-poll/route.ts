// Страховочный опрос СДЭК. Vercel Cron раз в 3 часа (vercel.json), заголовок Authorization: Bearer CRON_SECRET.
import { cdekFromEnv, shippingStore } from '@/lib/shipping/env';
import { pollCdek } from '@/lib/shipping/service';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('unauthorized', { status: 401 });

  const store = shippingStore();
  const cdek = cdekFromEnv();
  if (!store || !cdek) return Response.json({ skipped: 'shipping not configured' });
  return Response.json(await pollCdek(store, cdek));
}
