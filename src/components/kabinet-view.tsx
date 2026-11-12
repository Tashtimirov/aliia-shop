'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { telegramInitData } from './telegram';
import { fmtRub } from '@/lib/pricing';
import type { SizeProfile } from '@/lib/kabinet/sizing';

type MatchItem = {
  id: string; name: string; category: string | null; image: string | null; size: string; alternative: string | null;
  confidence: 'high' | 'medium' | 'low'; reason: string; colors: string[]; price_rub: number;
};
type Pick = { id: string; name: string; size: string; color: string; price_rub: number; reason: string };

const LOCAL_KEY = 'kabinet-profiles';
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];
const CONF = { high: 'точно', medium: 'скорее всего', low: 'уточните у Алии' } as const;
const CONF_CLASS = { high: 'text-emerald-700 dark:text-emerald-400', medium: 'text-amber-700 dark:text-amber-400', low: 'text-[var(--sale)]' } as const;
const newProfile = (label = 'Я'): SizeProfile => ({ id: `local-${Date.now()}`, label, gender: 'women', fit_preference: 'regular' });

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data as T;
}

export function KabinetView({ aiOn }: { aiOn: boolean }) {
  const [profiles, setProfiles] = useState<SizeProfile[]>([]);
  const [cur, setCur] = useState(0);
  const [stored, setStored] = useState(false); // профили лежат в базе (вход через Telegram), иначе в браузере
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<MatchItem[] | null>(null);
  const [ask, setAsk] = useState('');
  const [ai, setAi] = useState<{ busy?: boolean; summary?: string; picks?: Pick[]; error?: string }>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const initData = telegramInitData();
      if (initData) {
        try {
          const r = await post<{ stored: boolean; profiles: SizeProfile[] }>('/api/kabinet/profiles', { initData, action: 'list' });
          if (r.stored) { setStored(true); setProfiles(r.profiles.length ? r.profiles : [newProfile()]); return; }
        } catch { /* упадём на браузерное хранилище */ }
      }
      let local: SizeProfile[] = [];
      try { local = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); } catch {}
      setProfiles(local.length ? local : [newProfile()]);
    })();
  }, []);

  const p = profiles[cur];

  const loadMatches = useCallback(async (profile: SizeProfile) => {
    try {
      const r = await post<{ items: MatchItem[] }>('/api/kabinet/matches', { profile });
      setItems(r.items);
    } catch (e) { setStatus(e instanceof Error ? e.message : 'Ошибка'); }
  }, []);

  useEffect(() => {
    if (!p) return;
    const t = setTimeout(() => loadMatches(p), 400); // не дёргаем сервер на каждую цифру
    return () => clearTimeout(t);
  }, [p, loadMatches]);

  function update(patch: Partial<SizeProfile>) {
    const next = profiles.map((x, i) => (i === cur ? { ...x, ...patch } : x));
    setProfiles(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(next[cur], next), 700);
  }

  async function persist(profile: SizeProfile, all: SizeProfile[]) {
    if (!stored) {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(all)); } catch {}
      return;
    }
    try {
      const r = await post<{ profile: SizeProfile }>('/api/kabinet/profiles', { initData: telegramInitData(), action: 'save', profile });
      setProfiles((ps) => ps.map((x) => (x.id === profile.id ? { ...x, id: r.profile.id } : x)));
      setStatus('Сохранено');
    } catch (e) { setStatus(e instanceof Error ? e.message : 'Не сохранилось'); }
  }

  async function remove() {
    if (!p) return;
    if (stored && !p.id.startsWith('local-')) {
      try { await post('/api/kabinet/profiles', { initData: telegramInitData(), action: 'delete', id: p.id }); }
      catch (e) { setStatus(e instanceof Error ? e.message : 'Не удалилось'); return; }
    }
    const next = profiles.filter((_, i) => i !== cur);
    const fixed = next.length ? next : [newProfile()];
    setProfiles(fixed); setCur(0);
    if (!stored) try { localStorage.setItem(LOCAL_KEY, JSON.stringify(fixed)); } catch {}
  }

  async function pickWithAi() {
    if (!p) return;
    setAi({ busy: true });
    try {
      const r = await post<{ summary: string; picks: Pick[] }>('/api/kabinet/picks', { initData: telegramInitData() || undefined, profile: p, request: ask });
      setAi(r);
    } catch (e) { setAi({ error: e instanceof Error ? e.message : 'Ошибка' }); }
  }

  if (!p) return <p className="py-10 text-center text-[var(--muted)]">Загружаем кабинет…</p>;

  const num = (key: keyof SizeProfile, label: string, step = 1) => (
    <label className="block text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <input
        type="number" inputMode="decimal" step={step} value={(p[key] as number | null | undefined) ?? ''}
        onChange={(e) => update({ [key]: e.target.value === '' ? null : Number(e.target.value) })}
        className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-[var(--foreground)]"
      />
    </label>
  );
  const sel = (key: 'usual_top' | 'usual_bottom', label: string) => (
    <label className="block text-sm">
      <span className="text-[var(--muted)]">{label}</span>
      <select value={p[key] ?? ''} onChange={(e) => update({ [key]: e.target.value || null })}
        className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
        <option value="">не знаю</option>
        {SIZES.map((s) => <option key={s}>{s}</option>)}
      </select>
    </label>
  );

  return (
    <div className="grid gap-8 md:grid-cols-[340px_1fr]">
      <section className="space-y-4 self-start rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Мои размеры</h1>
          <button onClick={() => { setProfiles([...profiles, newProfile('Новый')]); setCur(profiles.length); }} className="text-sm text-[var(--accent)]">+ профиль</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {profiles.map((x, i) => (
            <button key={x.id} onClick={() => setCur(i)} aria-pressed={i === cur}
              className={`rounded-full border px-3 py-1 text-sm ${i === cur ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]' : 'border-[var(--line)]'}`}>
              {x.label || 'Без названия'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Название</span>
            <input value={p.label} onChange={(e) => update({ label: e.target.value })}
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-[var(--foreground)]" />
          </label>
          <label className="block text-sm">
            <span className="text-[var(--muted)]">Для кого</span>
            <select value={p.gender} onChange={(e) => update({ gender: e.target.value as SizeProfile['gender'] })}
              className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
              <option value="women">Женщина</option><option value="men">Мужчина</option><option value="kids">Ребёнок</option>
            </select>
          </label>
          {num('height_cm', 'Рост, см')}
          {num('weight_kg', 'Вес, кг')}
          {p.gender !== 'kids' && <>
            {num('chest_cm', 'Обхват груди, см')}
            {num('waist_cm', 'Обхват талии, см')}
            {num('hips_cm', 'Обхват бёдер, см')}
            {num('ru_size', 'Размер в России')}
            {sel('usual_top', 'Обычно верх')}
            {sel('usual_bottom', 'Обычно низ')}
            {num('jeans_waist_inch', 'Джинсы, дюймы')}
          </>}
          {num('foot_cm', 'Длина стопы, см', 0.1)}
        </div>
        <div className="space-y-1 text-sm">
          <span className="text-[var(--muted)]">Как люблю носить</span>
          <div className="flex overflow-hidden rounded-lg border border-[var(--line)]">
            {([['tight', 'Облегающе'], ['regular', 'По фигуре'], ['oversize', 'Свободно']] as const).map(([v, t]) => (
              <button key={v} onClick={() => update({ fit_preference: v })} aria-pressed={p.fit_preference === v}
                className={`flex-1 py-2 ${p.fit_preference === v ? 'bg-[var(--accent)] text-white' : ''}`}>{t}</button>
            ))}
          </div>
        </div>
        <label className="block text-sm">
          <span className="text-[var(--muted)]">Пожелания по стилю</span>
          <textarea value={p.style_notes ?? ''} onChange={(e) => update({ style_notes: e.target.value })} rows={2}
            placeholder="Например: люблю базу, бежевый и чёрный"
            className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 outline-none focus:border-[var(--foreground)]" />
        </label>
        <p className="text-xs text-[var(--muted)]">
          Хватит российского размера, но с обхватами в сантиметрах подбор точнее. {stored ? 'Профили сохраняются в вашем аккаунте.' : 'Профили сохранены в этом браузере; откройте магазин из Telegram-бота, чтобы они были везде.'}
        </p>
        <div className="flex items-center justify-between text-sm">
          <button onClick={remove} className="text-[var(--muted)] underline">Удалить профиль</button>
          <span className="text-[var(--muted)]" aria-live="polite">{status}</span>
        </div>
      </section>

      <div className="space-y-6">
        {aiOn && (
          <section className="space-y-3 rounded-xl border border-[var(--accent)] bg-[var(--surface)] p-4">
            <h2 className="font-semibold">Подбор от ИИ-стилиста</h2>
            <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={2} placeholder="Например: тёплый комплект на осень до 10 000 ₽"
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--background)] px-3 py-2 outline-none focus:border-[var(--foreground)]" />
            <button onClick={pickWithAi} disabled={ai.busy} className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white disabled:opacity-50">
              {ai.busy ? 'Подбираю…' : 'Подобрать'}
            </button>
            {ai.error && <p className="text-sm text-[var(--sale)]">{ai.error}</p>}
            {ai.summary && <p className="text-sm">{ai.summary}</p>}
            {ai.picks?.map((k) => (
              <Link key={k.id} href={`/p/${k.id}`} className="block border-l-2 border-[var(--accent)] pl-3 text-sm">
                <div className="font-medium">{k.name}</div>
                <div className="text-[var(--muted)]">Размер {k.size} · {k.color} · {fmtRub(k.price_rub)}</div>
                <div className="text-[var(--muted)]">{k.reason}</div>
              </Link>
            ))}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="font-semibold">Есть ваш размер{items ? ` · ${items.length}` : ''}</h2>
          {items === null && <p className="text-sm text-[var(--muted)]">Подбираем…</p>}
          {items?.length === 0 && <p className="text-sm text-[var(--muted)]">Пока ничего. Заполните рост, обхваты или российский размер, и подбор появится.</p>}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {items?.map((it) => (
              <Link key={it.id} href={`/p/${it.id}`} className="block space-y-1 text-sm">
                <div className="aspect-[3/4] overflow-hidden rounded-lg bg-[var(--line)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {it.image && <img src={it.image} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </div>
                <div className="line-clamp-2">{it.name}</div>
                <div><span className="rounded bg-[var(--foreground)] px-1.5 font-semibold text-[var(--background)]">{it.size}</span>{' '}
                  <span className={`text-xs ${CONF_CLASS[it.confidence]}`}>{CONF[it.confidence]}</span></div>
                <div className="text-xs text-[var(--muted)]">{it.reason}</div>
                <div className="font-medium">{fmtRub(it.price_rub)}</div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
