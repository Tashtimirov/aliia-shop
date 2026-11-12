import { STATUS_LABEL, STATUS_TONE, type OrderStatus } from '@/lib/crm/constants';

export function StatusPill({ status }: { status: OrderStatus }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

export const inputCls = 'w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm';
export const btnCls = 'rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-medium hover:border-[var(--muted)] disabled:opacity-50';
export const btnPrimaryCls = 'rounded-lg bg-[var(--foreground)] px-3 py-2 text-sm font-semibold text-[var(--background)] disabled:opacity-50';

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0 space-y-1 text-xs font-medium text-[var(--muted)]">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', timeZone: 'Asia/Bangkok' });
export const fmtDateTime = (s: string) =>
  new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
