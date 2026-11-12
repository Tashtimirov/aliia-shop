import { NextResponse } from 'next/server';
import { verifyInitData } from '@/lib/telegram';
import { db } from '@/lib/supabase';
import { deleteProfile, listProfiles, ProfileError, saveProfile } from '@/lib/kabinet/profiles';

/**
 * Профили размеров клиента. Сохраняются только при входе через Telegram (initData);
 * без него кабинет хранит профили в браузере.
 * Тело: { initData, action: 'list' | 'save' | 'delete', profile?, id? }
 */
export async function POST(req: Request) {
  let body: { initData?: string; action?: string; profile?: unknown; id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Неверный запрос' }, { status: 400 });
  }
  if (!db()) return NextResponse.json({ stored: false, profiles: [] });
  const tgUser = body.initData ? verifyInitData(body.initData) : null;
  if (!tgUser) return NextResponse.json({ stored: false, profiles: [] });
  try {
    if (body.action === 'save') return NextResponse.json({ stored: true, profile: await saveProfile(tgUser, body.profile) });
    if (body.action === 'delete' && typeof body.id === 'string') {
      await deleteProfile(tgUser, body.id);
      return NextResponse.json({ stored: true });
    }
    return NextResponse.json({ stored: true, profiles: await listProfiles(tgUser) });
  } catch (e) {
    if (e instanceof ProfileError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: 'Не получилось сохранить профиль, попробуйте ещё раз' }, { status: 500 });
  }
}
