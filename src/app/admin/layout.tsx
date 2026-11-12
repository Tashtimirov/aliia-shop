import Link from 'next/link';
import type { Metadata } from 'next';
import { logout } from '@/lib/crm/actions';

export const metadata: Metadata = { title: 'CRM · Aliia Buyer', robots: { index: false, follow: false } };

// Все страницы CRM читают сессию и базу на каждый запрос, мгновенная навигация из статической оболочки им не нужна.
export const instant = false;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <nav className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] pb-3 text-sm">
        <span className="mr-2 font-semibold">CRM</span>
        <Link href="/admin" className="rounded-lg px-2 py-1 hover:bg-[var(--surface)]">Заказы</Link>
        <Link href="/admin/clients" className="rounded-lg px-2 py-1 hover:bg-[var(--surface)]">Клиенты</Link>
        <Link href="/admin/orders/new" className="rounded-lg px-2 py-1 font-semibold text-[var(--accent)] hover:bg-[var(--surface)]">+ Заказ</Link>
        <form action={logout} className="ml-auto">
          <button className="text-xs text-[var(--muted)]">Выйти</button>
        </form>
      </nav>
      {children}
    </div>
  );
}
