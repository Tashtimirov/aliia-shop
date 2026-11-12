import { redirect } from 'next/navigation';
import { currentAdmin, passwordLoginEnabled } from '@/lib/crm/auth';
import { PasswordLogin, TelegramLogin } from '@/components/crm/login';

export default async function LoginPage() {
  if (await currentAdmin()) redirect('/admin');
  return (
    <div className="mx-auto max-w-sm space-y-4 py-8">
      <h1 className="text-xl font-semibold">Вход в CRM</h1>
      <TelegramLogin />
      <p className="text-sm text-[var(--muted)]">
        Из Telegram вход происходит сам, если ваш аккаунт в списке админов бота. На обычном сайте войдите по паролю.
      </p>
      {passwordLoginEnabled() ? <PasswordLogin /> : <p className="text-sm">Вход по паролю выключен: задайте CRM_ADMIN_PASSWORD на сервере.</p>}
    </div>
  );
}
