// Вебхук СДЭК. Регистрируется на https://<домен>/api/shipping/cdek-webhook/<CDEK_WEBHOOK_SECRET>
import { cdekFromEnv, shippingStore } from '@/lib/shipping/env';
import { handleCdekWebhook } from '@/lib/shipping/service';

export async function POST(req: Request, { params }: RouteContext<'/api/shipping/cdek-webhook/[secret]'>) {
  const { secret } = await params;
  const expected = process.env.CDEK_WEBHOOK_SECRET;
  if (!expected || secret !== expected) return new Response('not found', { status: 404 });

  const store = shippingStore();
  const cdek = cdekFromEnv();
  if (!store || !cdek) return new Response('shipping not configured', { status: 503 });

  try {
    return Response.json(await handleCdekWebhook(store, cdek, await req.json()));
  } catch (e) {
    console.error('cdek webhook', e);
    return new Response('error', { status: 500 }); // СДЭК повторит вебхук
  }
}
