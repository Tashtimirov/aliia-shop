import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/supabase';
import { verifyInitData } from '@/lib/telegram';

/**
 * Вход в CRM. Два способа:
 * 1) из Telegram (Mini App): подписанный initData, telegram id должен быть в ADMIN_IDS или settings.admins (тот же список, что у бота);
 * 2) на обычном сайте: пароль CRM_ADMIN_PASSWORD (если не задан, вход по паролю выключен).
 * Сессия — подписанная cookie на 14 дней.
 */

const COOKIE = 'crm_session';
const MAX_AGE = 14 * 24 * 3600;

export type Admin = { sub: string; name: string };

function secret(): Buffer | null {
  const s = process.env.CRM_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return s ? createHash('sha256').update(`crm-session:${s}`).digest() : null;
}

function sign(payload: string, key: Buffer) {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

export function encodeSession(admin: Admin, now = Date.now()): string | null {
  const key = secret();
  if (!key) return null;
  const payload = Buffer.from(JSON.stringify({ ...admin, exp: Math.floor(now / 1000) + MAX_AGE })).toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}

export function decodeSession(token: string | undefined, now = Date.now()): Admin | null {
  const key = secret();
  if (!token || !key) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload, key));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Admin & { exp: number };
    if (!data.exp || data.exp < now / 1000) return null;
    return { sub: data.sub, name: data.name };
  } catch {
    return null;
  }
}

/** Telegram id админов: ADMIN_IDS из env плюс settings.admins из базы. */
export async function adminTelegramIds(): Promise<number[]> {
  const fromEnv = (process.env.ADMIN_IDS ?? '').split(/[\s,]+/).map(Number).filter(Number.isInteger).filter((n) => n > 0);
  const client = db();
  let fromDb: number[] = [];
  if (client) {
    const { data } = await client.from('settings').select('value').eq('key', 'admins').maybeSingle();
    if (Array.isArray(data?.value)) fromDb = data.value.map(Number).filter(Number.isInteger);
  }
  return [...new Set([...fromEnv, ...fromDb])];
}

export async function adminFromInitData(initData: string): Promise<Admin | null> {
  const user = verifyInitData(initData);
  if (!user) return null;
  if (!(await adminTelegramIds()).includes(user.id)) return null;
  return { sub: `tg:${user.id}`, name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Админ' };
}

export function passwordMatches(input: string): boolean {
  const expected = process.env.CRM_ADMIN_PASSWORD;
  if (!expected || !input) return false;
  const a = createHash('sha256').update(input).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export const passwordLoginEnabled = () => !!process.env.CRM_ADMIN_PASSWORD;

export async function setSession(admin: Admin) {
  const token = encodeSession(admin);
  if (!token) throw new Error('Не задан CRM_SESSION_SECRET или SUPABASE_SERVICE_ROLE_KEY');
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: MAX_AGE });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function currentAdmin(): Promise<Admin | null> {
  return decodeSession((await cookies()).get(COOKIE)?.value);
}

/** Для страниц: без входа отправляет на /admin/login. */
export async function requireAdmin(): Promise<Admin> {
  const admin = await currentAdmin();
  if (!admin) redirect('/admin/login');
  return admin;
}

/** Для server actions и API: без входа бросает ошибку. */
export async function assertAdmin(): Promise<Admin> {
  const admin = await currentAdmin();
  if (!admin) throw new Error('Нужно войти в CRM');
  return admin;
}
