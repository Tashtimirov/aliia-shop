import 'server-only';
import { db } from '../supabase';
import { CdekClient, CDEK_TEST } from './cdek';
import { supabaseStore } from './supabaseStore';

/** Хранилище отправлений на общей базе. Null, если Supabase не настроен. */
export function shippingStore() {
  const client = db();
  return client ? supabaseStore(client) : null;
}

/** Клиент СДЭК из переменных окружения. Null, если ключей нет. */
export function cdekFromEnv() {
  const clientId = process.env.CDEK_CLIENT_ID;
  const clientSecret = process.env.CDEK_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return new CdekClient({ baseUrl: process.env.CDEK_API_URL || CDEK_TEST, clientId, clientSecret });
}
