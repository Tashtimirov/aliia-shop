'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setOrderStatus } from '@/lib/crm/actions';
import { MANUAL_STATUSES, PHOTO_KINDS, STATUS_LABEL, type OrderStatus, type PhotoKind } from '@/lib/crm/constants';
import { btnCls } from './ui';

export function StatusButtons({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const auto = !MANUAL_STATUSES.includes(status);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {MANUAL_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending || s === status}
            onClick={() => start(async () => {
              setError('');
              try {
                await setOrderStatus(orderId, s);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Не получилось');
              }
            })}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${s === status ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]' : 'border-[var(--line)] bg-[var(--surface)]'} disabled:cursor-default`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--muted)]">
        {auto ? `Сейчас «${STATUS_LABEL[status]}»: этот статус поставила доставка по треку. ` : ''}
        «Отправлен», «В России» и «Доставлен» ставятся автоматически по трек-номеру. Клиент получает уведомление о каждом статусе от бота.
      </p>
      {error && <p className="text-sm text-[var(--sale)]">{error}</p>}
    </div>
  );
}

/** Уменьшает фото с телефона до 1600 px по длинной стороне (JPEG), чтобы загрузка шла быстро. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res) => canvas.toBlob((b) => res(b ?? file), 'image/jpeg', 0.85));
  } catch {
    return file;
  }
}

export function PhotoUpload({ orderId, itemId, kind }: { orderId: string; itemId?: string; kind: PhotoKind }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    for (const f of Array.from(files)) {
      const blob = await shrink(f);
      const fd = new FormData();
      fd.set('file', new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }));
      fd.set('order_id', orderId);
      fd.set('kind', kind);
      if (itemId) fd.set('order_item_id', itemId);
      const res = await fetch('/api/crm/photos', { method: 'POST', body: fd });
      if (!res.ok) {
        setError((await res.json().catch(() => null))?.error ?? 'Фото не загрузилось');
        break;
      }
    }
    setBusy(false);
    if (input.current) input.current.value = '';
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <label className={`flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-[var(--line)] text-center text-xs font-semibold text-[var(--muted)] hover:border-[var(--accent)] ${busy ? 'opacity-60' : ''}`}>
        {busy ? 'Загрузка…' : `+ ${PHOTO_KINDS[kind].toLowerCase()}`}
        <input ref={input} type="file" accept="image/*" capture="environment" multiple className="hidden" disabled={busy} onChange={(e) => upload(e.target.files)} />
      </label>
      {error && <span className="max-w-40 text-xs text-[var(--sale)]">{error}</span>}
    </span>
  );
}

export function CopyButton({ text, label = 'Скопировать' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={btnCls}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* буфер недоступен: текст выделяется вручную */
        }
      }}
    >
      {done ? 'Скопировано' : label}
    </button>
  );
}

/** Кнопка удаления с подтверждением вторым нажатием. Должна стоять внутри формы с server action. */
export function ConfirmSubmit({ children, confirmText }: { children: React.ReactNode; confirmText: string }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <button className="rounded-lg bg-[var(--sale)] px-3 py-1.5 text-sm font-semibold text-white">{confirmText}</button>
      <button type="button" className="text-sm text-[var(--muted)]" onClick={() => setArmed(false)}>Отмена</button>
    </span>
  ) : (
    <button type="button" className="text-sm font-medium text-[var(--sale)]" onClick={() => setArmed(true)}>{children}</button>
  );
}
