// Один запуск: собрать снимок → найти дела → решить, что слать → сводка (ИИ) → Telegram → сохранить состояние.
import type Anthropic from '@anthropic-ai/sdk';
import { buildDigest } from './digest';
import { findOpenIssues } from './rules';
import { plan, type ReminderState } from './state';
import { keyboard, sendToAdmins } from './telegram';
import type { Finding, Snapshot, Thresholds } from './types';
import { DEFAULT_THRESHOLDS } from './types';

export interface ReminderSettings {
  enabled?: boolean;
  thresholds?: Partial<Thresholds>;
  min_severity?: 'urgent' | 'normal' | 'low';
  snooze_days?: number;
}

export interface ReminderStore {
  snapshot(now: Date): Promise<Snapshot>;
  settings(): Promise<{ reminders: ReminderSettings; admins: (number | string)[] }>;
  states(): Promise<ReminderState[]>;
  /** upsert по key: last_seen_at = now, title; новые получают id. Возвращает key → id. */
  touch(findings: Finding[], now: Date): Promise<Map<string, number>>;
  markSent(keys: string[], now: Date): Promise<void>;
  markResolved(keys: string[], now: Date): Promise<void>;
  logRun(r: { found: number; sent: number; text: string; used_ai: boolean }): Promise<void>;
  snooze(id: number, until: Date): Promise<string | null>;   // возвращает title
  dismiss(id: number, now: Date): Promise<string | null>;
}

const SEV_RANK = { urgent: 0, normal: 1, low: 2 } as const;

export async function runReminders(
  store: ReminderStore,
  opts: { telegramToken: string; now?: Date; ai?: boolean; anthropic?: Anthropic; fetch?: typeof fetch; dryRun?: boolean },
) {
  const now = opts.now ?? new Date();
  const { reminders: cfg, admins } = await store.settings();
  if (cfg.enabled === false) return { skipped: 'disabled' as const };

  const snap = await store.snapshot(now);
  const minRank = SEV_RANK[cfg.min_severity ?? 'low'];
  const findings = findOpenIssues(snap, { ...DEFAULT_THRESHOLDS, ...cfg.thresholds })
    .filter((f) => SEV_RANK[f.severity] <= minRank);

  const states = await store.states();
  const p = plan(findings, states, now);
  if (opts.dryRun) return { found: findings.length, plan: p };

  const ids = await store.touch(findings, now);
  for (const f of p.send) f.state_id = ids.get(f.key) ?? f.state_id;
  await store.markResolved(p.resolvedKeys, now);

  const { text, usedAi } = await buildDigest(p, { ai: opts.ai, client: opts.anthropic });
  const sent = await sendToAdmins(opts.telegramToken, admins, text, keyboard(p), opts.fetch);
  if (sent) await store.markSent(p.send.map((f) => f.key), now);
  await store.logRun({ found: findings.length, sent: p.send.length, text, used_ai: usedAi });
  return { found: findings.length, sent: p.send.length, skipped: p.skipped, resolved: p.resolvedKeys.length, usedAi, delivered: sent };
}

/** Для бота: нажатие кнопки под сводкой. Возвращает текст для answerCallbackQuery или null, если это не наша кнопка. */
export async function handleReminderCallback(store: ReminderStore, data: string, now = new Date(), snoozeDays = 1) {
  const m = data.match(/^rem:([sd]):(\d+)$/);
  if (!m) return null;
  const id = Number(m[2]);
  if (m[1] === 's') {
    const title = await store.snooze(id, new Date(now.getTime() + snoozeDays * 86_400_000));
    return title ? `Отложено до завтра: ${title.split(':')[0]}` : 'Уже неактуально';
  }
  const title = await store.dismiss(id, now);
  return title ? `Больше не напомню: ${title.split(':')[0]}` : 'Уже неактуально';
}
