import { NextResponse } from 'next/server';
import { currentAdmin } from '@/lib/crm/auth';
import { db } from '@/lib/supabase';

/**
 * Показ фото заказа только админам. Фото из CRM лежат в приватном bucket order-photos (отдаём подписанную ссылку),
 * фото, присланные через бота, хранятся как telegram_file_id (скачиваем через Bot API и отдаём сами).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await currentAdmin())) return new NextResponse('Нужно войти в CRM', { status: 401 });
  const client = db();
  if (!client) return new NextResponse('База не подключена', { status: 503 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse('Нет фото', { status: 404 });

  const { data: photo } = await client.from('order_photos').select('storage_path, telegram_file_id').eq('id', id).maybeSingle();
  if (!photo) return new NextResponse('Нет фото', { status: 404 });

  if (photo.storage_path) {
    const { data, error } = await client.storage.from('order-photos').createSignedUrl(photo.storage_path, 3600);
    if (error || !data) return new NextResponse('Фото недоступно', { status: 502 });
    return NextResponse.redirect(data.signedUrl, { status: 302, headers: { 'cache-control': 'private, max-age=3000' } });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (photo.telegram_file_id && token) {
    const meta = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(photo.telegram_file_id)}`).then((r) => r.json()).catch(() => null);
    const filePath = meta?.ok ? meta.result?.file_path : null;
    if (filePath) {
      const file = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      if (file.ok && file.body) {
        return new NextResponse(file.body, {
          headers: { 'content-type': file.headers.get('content-type') || 'image/jpeg', 'cache-control': 'private, max-age=86400' },
        });
      }
    }
  }
  return new NextResponse('Фото недоступно', { status: 404 });
}
