'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useCart } from './cart';
import { telegramInitData } from './telegram';
import { cardPriceRub, fmtRub, orderTotal } from '@/lib/pricing';
import type { Pricing } from '@/lib/types';

export function CartView({ pricing }: { pricing: Pricing }) {
  const { lines, setQty, clear } = useCart();
  const [contact, setContact] = useState({ name: '', telegram_username: '', phone: '', city: '', comment: '' });
  const [state, setState] = useState<{ sending?: boolean; error?: string; done?: string }>({});
  const total = orderTotal(lines, pricing);
  const inTelegram = typeof window !== 'undefined' && !!telegramInitData();

  if (state.done) {
    return (
      <div className="space-y-3 py-10 text-center">
        <h1 className="text-xl font-semibold">Заказ {state.done} оформлен</h1>
        <p className="text-sm text-[var(--muted)]">Алия проверит наличие и пришлёт итоговую сумму с доставкой и реквизиты для оплаты в Telegram.</p>
        <Link href="/" className="inline-block underline">Вернуться в каталог</Link>
      </div>
    );
  }

  if (!lines.length) {
    return (
      <div className="space-y-3 py-10 text-center">
        <p>Корзина пуста</p>
        <Link href="/" className="underline">В каталог</Link>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ sending: true });
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lines: lines.map((l) => ({ variant_id: l.variant_id, qty: l.qty })), contact, initData: telegramInitData() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка');
      clear();
      setState({ done: data.label });
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : 'Ошибка' });
    }
  }

  const field = (key: keyof typeof contact, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <input
        {...props}
        value={contact[key]}
        onChange={(e) => setContact({ ...contact, [key]: e.target.value })}
        className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-[var(--foreground)]"
      />
    </label>
  );

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Корзина</h1>
        {lines.map((l) => (
          <div key={l.variant_id} className="flex gap-3 border-b border-[var(--line)] pb-4">
            <div className="h-24 w-18 flex-none overflow-hidden rounded bg-[var(--line)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {l.image_url && <img src={l.image_url} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="flex-1 space-y-1 text-sm">
              <Link href={`/p/${l.product_id}`} className="line-clamp-2">{l.name}</Link>
              <div className="text-[var(--muted)]">{l.color} · {l.size}</div>
              <div className="flex items-center gap-3">
                <button aria-label="Меньше" onClick={() => setQty(l.variant_id, l.qty - 1)} className="h-7 w-7 rounded border border-[var(--line)]">−</button>
                <span>{l.qty}</span>
                <button aria-label="Больше" onClick={() => setQty(l.variant_id, l.qty + 1)} className="h-7 w-7 rounded border border-[var(--line)]">+</button>
                <span className="ml-auto font-medium">{fmtRub(cardPriceRub(l.price_thb, pricing) * l.qty)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-3 self-start rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex justify-between text-sm"><span>Вещи с выкупом и комиссией</span><span>{fmtRub(total.totalRub)}</span></div>
        <div className="flex justify-between text-sm text-[var(--muted)]"><span>Доставка</span><span>по весу, Алия посчитает</span></div>
        <p className="text-xs text-[var(--muted)]">Минимальная комиссия за заказ {fmtRub(pricing.commission_min_rub)}. Оплата после подтверждения наличия.</p>
        {field('name', 'Имя', { required: true, autoComplete: 'name' })}
        {!inTelegram && field('telegram_username', 'Telegram (@ник)', { placeholder: '@username' })}
        {field('phone', 'Телефон', { type: 'tel', autoComplete: 'tel', placeholder: '+7…' })}
        {field('city', 'Город доставки', { autoComplete: 'address-level2' })}
        {field('comment', 'Комментарий', { placeholder: 'Например: если нет M, возьмите L' })}
        {state.error && <p className="text-sm text-[var(--sale)]">{state.error}</p>}
        <button disabled={state.sending} className="w-full rounded-lg bg-[var(--accent)] py-3 font-medium text-white disabled:opacity-50">
          {state.sending ? 'Отправляем…' : 'Оформить заказ'}
        </button>
      </form>
    </div>
  );
}
