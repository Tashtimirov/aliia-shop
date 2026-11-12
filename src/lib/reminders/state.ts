// Что из найденного отправлять сегодня, а что пропустить (отложено / «не напоминать»).
import type { Finding } from './types';

export interface ReminderState {
  id: number;
  key: string;
  first_seen_at: string;
  last_sent_at: string | null;
  snoozed_until: string | null;
  dismissed_at: string | null;
  resolved_at: string | null;
}

export interface Plan {
  send: (Finding & { state_id?: number; is_new: boolean })[];
  skipped: number;
  resolvedKeys: string[]; // были открыты, сейчас не найдены: решилось
}

export function plan(findings: Finding[], states: ReminderState[], now: Date): Plan {
  const byKey = new Map(states.map((s) => [s.key, s]));
  const found = new Set(findings.map((f) => f.key));
  const send: Plan['send'] = [];
  let skipped = 0;
  for (const f of findings) {
    const st = byKey.get(f.key);
    const open = st && !st.resolved_at;
    if (open && st.dismissed_at) { skipped++; continue; }
    if (open && st.snoozed_until && new Date(st.snoozed_until) > now) { skipped++; continue; }
    send.push({ ...f, state_id: open ? st.id : undefined, is_new: !open });
  }
  const resolvedKeys = states.filter((s) => !s.resolved_at && !found.has(s.key)).map((s) => s.key);
  return { send, skipped, resolvedKeys };
}
