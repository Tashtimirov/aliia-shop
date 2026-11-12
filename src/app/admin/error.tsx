'use client';

export default function CrmError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3 rounded-xl border border-[var(--sale)] p-4 text-sm">
      <p className="font-semibold">Не получилось: {error.message || 'ошибка сервера'}</p>
      <button className="underline" onClick={reset}>Попробовать ещё раз</button>
    </div>
  );
}
