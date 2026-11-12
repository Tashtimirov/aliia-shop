'use client';

import { useActionState, useEffect, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { loginWithPassword, loginWithTelegram } from '@/lib/crm/actions';
import { telegramInitData } from '@/components/telegram';
import { btnPrimaryCls, inputCls } from './ui';

const noopSubscribe = () => () => {};

export function TelegramLogin() {
  const router = useRouter();
  const inTelegram = useSyncExternalStore(noopSubscribe, () => !!telegramInitData(), () => false);
  const [error, setError] = useState('');
  useEffect(() => {
    const initData = telegramInitData();
    if (!initData) return;
    loginWithTelegram(initData).then((r) => {
      if (r.ok) router.replace('/admin');
      else setError(r.error ?? 'Нет доступа');
    });
  }, [router]);
  if (error) return <p className="text-sm text-[var(--sale)]">{error}. Добавьте свой Telegram id в список админов.</p>;
  if (inTelegram) return <p className="text-sm">Проверяю вход через Telegram…</p>;
  return null;
}

export function PasswordLogin() {
  const [state, action, pending] = useActionState(loginWithPassword, null);
  return (
    <form action={action} className="space-y-3">
      <input name="password" type="password" autoComplete="current-password" placeholder="Пароль CRM" className={inputCls} required />
      {state?.error && <p className="text-sm text-[var(--sale)]">{state.error}</p>}
      <button className={btnPrimaryCls} disabled={pending}>{pending ? 'Вхожу…' : 'Войти'}</button>
    </form>
  );
}
