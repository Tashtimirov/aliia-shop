// Ежедневная сводка нерешённых дел для Алии. Vercel Cron в 9:00 по Бангкоку (02:00 UTC):
// vercel.json: {"crons":[{"path":"/api/reminders/cron","schedule":"0 2 * * *"}]}
// ?dry=1 — посмотреть, что нашлось, ничего не отправляя.
import { db } from '@/lib/supabase';
import { runReminders } from '@/lib/reminders/service';
import { supabaseReminderStore } from '@/lib/reminders/supabaseStore';

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`)
    return new Response('no', { status: 401 });
  const client = db();
  if (!client) return Response.json({ error: 'База не настроена' }, { status: 503 });
  const dryRun = new URL(req.url).searchParams.get('dry') === '1';
  return Response.json(await runReminders(supabaseReminderStore(client), {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    ai: !!process.env.ANTHROPIC_API_KEY,
    dryRun,
  }));
}
