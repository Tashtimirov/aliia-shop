// Отправка сводки админам и кнопки «Отложить» / «Не напоминать».
// Кнопки обрабатывает бот (ветка бота): callback_data 'rem:s:<id>' или 'rem:d:<id>' → handleReminderCallback.
import type { Plan } from './state';

export const MAX_BUTTONS = 8;

export function keyboard(p: Plan) {
  const rows = p.send
    .filter((f) => f.state_id != null)
    .slice(0, MAX_BUTTONS)
    .map((f) => {
      const short = f.title.split(':')[0].slice(0, 22);
      return [
        { text: `⏰ ${short}: завтра`, callback_data: `rem:s:${f.state_id}` },
        { text: '🔕', callback_data: `rem:d:${f.state_id}` },
      ];
    });
  return rows.length ? { inline_keyboard: rows } : undefined;
}

export async function sendToAdmins(
  token: string, chatIds: (number | string)[], text: string,
  replyMarkup?: unknown, f: typeof fetch = fetch,
) {
  let sent = 0;
  for (const chat_id of chatIds) {
    const r = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id, text, reply_markup: replyMarkup, disable_web_page_preview: true }),
    });
    if (r.ok) sent++;
    else console.error('reminders: telegram send failed', chat_id, r.status, await r.text());
  }
  return sent;
}
