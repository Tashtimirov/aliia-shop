import { NextResponse } from 'next/server';
import { currentAdmin } from '@/lib/crm/auth';
import { PHOTO_KINDS } from '@/lib/crm/constants';
import { db } from '@/lib/supabase';

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/** Загрузка фото этикетки/товара к заказу: bucket order-photos, путь {order_id}/{kind}-{время}.{ext}, строка в order_photos. */
export async function POST(req: Request) {
  if (!(await currentAdmin())) return NextResponse.json({ error: 'Нужно войти в CRM' }, { status: 401 });
  const client = db();
  if (!client) return NextResponse.json({ error: 'База не подключена' }, { status: 503 });

  const fd = await req.formData().catch(() => null);
  const file = fd?.get('file');
  const orderId = fd?.get('order_id');
  const itemId = fd?.get('order_item_id') || null;
  const kind = String(fd?.get('kind') ?? '');
  if (!(file instanceof File) || !isUuid(orderId) || (itemId !== null && !isUuid(itemId)) || !(kind in PHOTO_KINDS)) {
    return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 });
  }
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: 'Нужен JPG, PNG или WebP' }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Фото больше 8 МБ' }, { status: 413 });

  const { data: order } = await client.from('orders').select('id').eq('id', orderId).maybeSingle();
  if (!order) return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
  if (itemId) {
    const { data: item } = await client.from('order_items').select('id').eq('id', itemId).eq('order_id', orderId).maybeSingle();
    if (!item) return NextResponse.json({ error: 'Позиция не найдена' }, { status: 404 });
  }

  const path = `${orderId}/${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const up = await client.storage.from('order-photos').upload(path, file, { contentType: file.type, upsert: false });
  if (up.error) return NextResponse.json({ error: `Хранилище: ${up.error.message}` }, { status: 502 });

  const { data, error } = await client
    .from('order_photos')
    .insert({ order_id: orderId, order_item_id: itemId, kind, storage_path: path })
    .select('id')
    .single();
  if (error) {
    await client.storage.from('order-photos').remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ id: data.id });
}
