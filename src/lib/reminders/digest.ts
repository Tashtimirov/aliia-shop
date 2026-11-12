// Сводка для Алии. Список дел считает код (rules.ts), Claude только пишет короткое человеческое сообщение:
// что горит, с чего начать, что можно объединить (например, напомнить об оплате трём клиентам сразу).
// Если ИИ недоступен, уходит простой список: напоминание не должно пропасть из-за API.
import Anthropic from '@anthropic-ai/sdk';
import type { Plan } from './state';

export const MODEL = 'claude-opus-5-5';
const MAX_TG = 3800; // лимит Telegram 4096 символов, с запасом

const SEV = { urgent: '🔴', normal: '🟡', low: '⚪' } as const;

export function plainDigest(p: Plan): string {
  if (!p.send.length) return '✅ Нерешённых дел нет. Хорошего дня!';
  const lines = p.send.map((f) => `${SEV[f.severity]} ${f.is_new ? '🆕 ' : ''}${f.title}\n   → ${f.action}`);
  let text = `Нерешённые дела (${p.send.length}):\n\n` + lines.join('\n');
  if (p.resolvedKeys.length) text += `\n\nСо вчера решилось само: ${p.resolvedKeys.length}`;
  return text.length > MAX_TG ? text.slice(0, MAX_TG - 20) + '\n…и ещё в CRM' : text;
}

const SYSTEM = `Ты помощник Алии, байера в Бангкоке: она выкупает вещи Uniqlo и отправляет русскоязычным клиентам в Россию.
Каждое утро ты пишешь ей в Telegram короткую сводку нерешённых дел по заказам. Список дел уже найден программой, ничего не добавляй от себя и не выдумывай номера, суммы и имена.
Как писать:
- по-русски, на «ты», тепло и по делу, без канцелярита и без markdown (Telegram покажет звёздочки как есть);
- сначала одна фраза: сколько дел и что самое срочное;
- затем дела, сгруппированные по смыслу действия (например «Напомнить об оплате: A-0012 Анна, A-0015 Ольга»), срочные выше; у каждой группы одно действие;
- отметь 🆕 то, что появилось впервые; 🔴 срочное;
- если дел больше 15, покажи 15 самых важных и напиши, сколько осталось;
- не длиннее ${MAX_TG} символов, без приветствий в конце.`;

export async function aiDigest(p: Plan, client: Anthropic = new Anthropic()): Promise<string> {
  const items = p.send.map((f) => ({
    severity: f.severity, new: f.is_new, days: f.days, problem: f.title, action: f.action, rule: f.rule,
  }));
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `Дела на сегодня (JSON):\n${JSON.stringify(items)}\nРешилось само со вчера: ${p.resolvedKeys.length}. Напиши сводку.`,
    }],
  } as Anthropic.Beta.Messages.MessageCreateParamsNonStreaming);
  if (res.stop_reason === 'refusal') throw new Error('refusal');
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
  if (!text) throw new Error('empty');
  return text.length > MAX_TG ? text.slice(0, MAX_TG - 1) + '…' : text;
}

/** Сводка с ИИ, при любой ошибке простой список. Пустой день без ИИ (экономим). */
export async function buildDigest(p: Plan, opts: { ai?: boolean; client?: Anthropic } = {}) {
  if (!p.send.length || opts.ai === false) return { text: plainDigest(p), usedAi: false };
  try {
    return { text: await aiDigest(p, opts.client), usedAi: true };
  } catch (e) {
    console.error('reminders: AI digest failed, sending plain list', e);
    return { text: plainDigest(p), usedAi: false };
  }
}
