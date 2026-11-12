// node --experimental-strip-types --test test/tryon.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayStartIso, garmentCategory, orderProviders, pickGarmentImage, tryOn, TryOnError, type Files, type Product, type Profile, type Store, type TryOnRow } from './tryon.ts';
import { fashn, kling, type TryOnProvider, type TryOnRequest } from './providers.ts';

const CLIENT = 'c1';
const profile: Profile = { id: 'p1', client_id: CLIENT, tryon_photo_path: 'c1/p1.jpg', tryon_consent_at: '2026-11-12T00:00:00Z', updated_at: 'v1' };
const tee: Product = {
  id: 'tee', category: 'tops', is_active: true,
  images: [
    { url: 'https://img/tee-09-model.jpg', color_code: '09', kind: 'model' },
    { url: 'https://img/tee-09-flat.jpg', color_code: '09', kind: 'flat' },
    { url: 'https://img/tee-00-main.jpg', color_code: '00', kind: 'main' },
  ],
};
const socks: Product = { id: 'socks', category: 'accessories', is_active: true, images: [{ url: 'x', color_code: '09', kind: 'main' }] };

function memory(opts: { vip?: boolean; profiles?: Profile[] } = {}) {
  const rows: TryOnRow[] = [];
  let n = 0;
  const store: Store = {
    getProfile: async (id) => (opts.profiles ?? [profile]).find((p) => p.id === id) ?? null,
    getProduct: async (id) => [tee, socks].find((p) => p.id === id) ?? null,
    getResult: async (id) => rows.find((r) => r.id === id) ?? null,
    findCached: async (k) => rows.find((r) => r.profile_id === k.profileId && r.product_id === k.productId && r.color_code === k.colorCode
      && r.photo_version === k.photoVersion && r.base_result_id === k.baseResultId && r.status !== 'failed') ?? null,
    countToday: async (c, since) => rows.filter((r) => r.client_id === c && r.status !== 'failed' && r.created_at >= since).length,
    isVip: async () => !!opts.vip,
    insertPending: async (r) => { const row = { ...r, id: `r${++n}`, status: 'pending' as const, result_path: null, created_at: new Date().toISOString() }; rows.push(row); return row; },
    markDone: async (id, path, _c, provider) => { Object.assign(rows.find((r) => r.id === id)!, { status: 'done', result_path: path, provider }); },
    markFailed: async (id) => { rows.find((r) => r.id === id)!.status = 'failed'; },
  };
  const saved: string[] = [];
  const files: Files = {
    signedPhotoUrl: async (p) => `signed-photo:${p}`,
    signedResultUrl: async (p) => `signed-result:${p}`,
    saveResult: async (p) => { saved.push(p); },
  };
  return { store, files, rows, saved };
}

function fake(name: 'fashn' | 'kling', fail = false) {
  const calls: TryOnRequest[] = [];
  const p: TryOnProvider = { name, costUsd: 0.07, run: async (r) => { calls.push(r); if (fail) throw new Error('down'); return { imageUrl: `https://fal/${name}.jpg` }; } };
  return { p, calls };
}

const settings = { provider: 'fashn' as const, daily_limit: 2, daily_limit_vip: 5 };

test('выбирает флэтлэй нужного цвета', () => {
  assert.deepEqual(pickGarmentImage(tee.images, '09'), { url: 'https://img/tee-09-flat.jpg', type: 'flat-lay' });
  assert.deepEqual(pickGarmentImage(tee.images, '00'), { url: 'https://img/tee-00-main.jpg', type: 'auto' });
  assert.equal(pickGarmentImage(tee.images, '55'), null);
});

test('категории: платья целиком, аксессуары нельзя', () => {
  assert.equal(garmentCategory('dresses'), 'one-pieces');
  assert.equal(garmentCategory('outerwear'), 'tops');
  assert.equal(garmentCategory('shoes'), null);
  assert.equal(garmentCategory(null), 'auto');
});

test('примерка: сохраняет результат и отдаёт подписанную ссылку', async () => {
  const m = memory(); const f = fake('fashn');
  const r = await tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: '09' }, { ...m, providers: [f.p], settings });
  assert.equal(r.cached, false);
  assert.equal(r.imageUrl, `signed-result:c1/${r.id}.jpg`);
  assert.equal(r.leftToday, 1);
  assert.equal(f.calls[0].personImageUrl, 'signed-photo:c1/p1.jpg');
  assert.equal(f.calls[0].garmentImageUrl, 'https://img/tee-09-flat.jpg');
  assert.equal(f.calls[0].category, 'tops');
});

test('повторный клик берётся из кэша без оплаты', async () => {
  const m = memory(); const f = fake('fashn');
  const a = await tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: '09' }, { ...m, providers: [f.p], settings });
  const b = await tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: '09' }, { ...m, providers: [f.p], settings });
  assert.equal(b.cached, true); assert.equal(b.id, a.id); assert.equal(f.calls.length, 1);
});

test('дневной лимит, у VIP больше', async () => {
  const m = memory(); const f = fake('fashn');
  for (const c of ['09', '00']) await tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: c }, { ...m, providers: [f.p], settings });
  tee.images.push({ url: 'https://img/tee-31.jpg', color_code: '31', kind: 'main' });
  await assert.rejects(tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: '31' }, { ...m, providers: [f.p], settings }),
    (e: TryOnError) => e.code === 'limit');
  const v = memory({ vip: true });
  for (const c of ['09', '00', '31']) await tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: c }, { ...v, providers: [f.p], settings });
  tee.images.pop();
});

test('без фото, без согласия, чужой профиль, аксессуар', async () => {
  const noPhoto = memory({ profiles: [{ ...profile, tryon_photo_path: null }] });
  const deps = (m: ReturnType<typeof memory>) => ({ ...m, providers: [fake('fashn').p], settings });
  await assert.rejects(tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: '09' }, deps(noPhoto)), (e: TryOnError) => e.code === 'no_photo');
  const noConsent = memory({ profiles: [{ ...profile, tryon_consent_at: null }] });
  await assert.rejects(tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: '09' }, deps(noConsent)), (e: TryOnError) => e.code === 'no_consent');
  await assert.rejects(tryOn({ clientId: 'other', profileId: 'p1', productId: 'tee', colorCode: '09' }, deps(memory())), (e: TryOnError) => e.code === 'forbidden');
  await assert.rejects(tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'socks', colorCode: '09' }, deps(memory())), (e: TryOnError) => e.code === 'not_wearable');
});

test('если FASHN упал, пробует Kling; если оба, ошибка и лимит не тратится', async () => {
  const m = memory(); const a = fake('fashn', true); const b = fake('kling');
  const r = await tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: '09' }, { ...m, providers: [a.p, b.p], settings });
  assert.equal(m.rows.find((x) => x.id === r.id)!.provider, 'kling');
  const m2 = memory();
  await assert.rejects(tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: '09' }, { ...m2, providers: [fake('fashn', true).p, fake('kling', true).p], settings }),
    (e: TryOnError) => e.code === 'failed');
  assert.equal(m2.rows[0].status, 'failed');
  assert.equal(await m2.store.countToday(CLIENT, '2000-01-01'), 0);
});

test('«примерить с этим»: надевает поверх прошлой примерки', async () => {
  const m = memory(); const f = fake('fashn');
  const first = await tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: '09' }, { ...m, providers: [f.p], settings: { ...settings, daily_limit: 5 } });
  await tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: '00', baseResultId: first.id }, { ...m, providers: [f.p], settings: { ...settings, daily_limit: 5 } });
  assert.equal(f.calls[1].personImageUrl, `signed-result:c1/${first.id}.jpg`);
});

test('новое фото профиля сбрасывает кэш', async () => {
  const m = memory({ profiles: [profile] }); const f = fake('fashn');
  await tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: '09' }, { ...m, providers: [f.p], settings });
  const m2 = { ...m, store: { ...m.store, getProfile: async () => ({ ...profile, updated_at: 'v2' }) } };
  const r = await tryOn({ clientId: CLIENT, profileId: 'p1', productId: 'tee', colorCode: '09' }, { ...m2, providers: [f.p], settings });
  assert.equal(r.cached, false);
});

test('лимит обнуляется в полночь по Бангкоку', () => {
  assert.equal(dayStartIso(new Date('2026-11-12T03:00:00Z')), '2026-11-11T17:00:00.000Z');
  assert.equal(dayStartIso(new Date('2026-11-12T18:00:00Z')), '2026-11-12T17:00:00.000Z');
});

test('провайдеры fal: правильные запросы и разбор ответов', async () => {
  const sent: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const fetchFn = (async (url: string, init: RequestInit & { headers: Record<string, string> }) => {
    sent.push({ url, body: JSON.parse(String(init.body)), auth: init.headers.Authorization });
    const json = url.includes('fashn') ? { images: [{ url: 'https://fal/a.jpg' }] } : { image: { url: 'https://fal/b.png' } };
    return new Response(JSON.stringify(json), { status: 200 });
  }) as typeof fetch;
  const req = { personImageUrl: 'P', garmentImageUrl: 'G', category: 'tops' as const, garmentPhotoType: 'flat-lay' as const };
  assert.equal((await fashn('k', 'balanced', fetchFn).run(req)).imageUrl, 'https://fal/a.jpg');
  assert.equal((await kling('k', fetchFn).run(req)).imageUrl, 'https://fal/b.png');
  assert.equal(sent[0].url, 'https://fal.run/fal-ai/fashn/tryon/v1.6');
  assert.equal(sent[0].auth, 'Key k');
  assert.deepEqual([sent[0].body.model_image, sent[0].body.garment_image, sent[0].body.category, sent[0].body.garment_photo_type], ['P', 'G', 'tops', 'flat-lay']);
  assert.deepEqual([sent[1].body.human_image_url, sent[1].body.garment_image_url], ['P', 'G']);
  assert.deepEqual(orderProviders([fashn('k'), kling('k')], 'kling').map((p) => p.name), ['kling', 'fashn']);
});
