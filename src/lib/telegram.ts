import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string };

/**
 * Проверка initData Telegram Mini App (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * Возвращает пользователя или null, если подпись неверна, данные старше maxAgeSec или токен бота не задан.
 */
export function verifyInitData(initData: string, botToken = process.env.TELEGRAM_BOT_TOKEN, maxAgeSec = 24 * 3600): TelegramUser | null {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get('user') ?? 'null') as TelegramUser | null;
    return user?.id ? user : null;
  } catch {
    return null;
  }
}
