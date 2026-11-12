// Подбор размера по профилю клиента и таблицам размеров бренда.
// Чистые функции без базы и сети: их вызывают витрина (фильтр «есть мой размер»), бот и ИИ-помощник.

export type Gender = 'women' | 'men' | 'kids' | 'baby' | 'unisex';
export type ProfileGender = 'women' | 'men' | 'kids';
export type Category = 'tops' | 'bottoms' | 'outerwear' | 'dresses' | 'innerwear' | 'shoes' | 'accessories';
export type SizeSystem = 'alpha' | 'waist_inch' | 'shoe_cm' | 'kids_cm' | 'one_size';
export type ProductFit = 'slim' | 'regular' | 'relaxed' | 'oversized' | null;
export type FitPreference = 'tight' | 'regular' | 'oversize';

export interface SizeProfile {
  id: string;
  label: string;
  gender: ProfileGender;
  height_cm?: number | null;
  weight_kg?: number | null;
  chest_cm?: number | null;
  waist_cm?: number | null;
  hips_cm?: number | null;
  foot_cm?: number | null;
  ru_size?: number | null;
  usual_top?: string | null;
  usual_bottom?: string | null;
  jeans_waist_inch?: number | null;
  fit_preference?: FitPreference | null;
  style_notes?: string | null;
}

/** Строка таблицы size_charts (обхваты тела в см). */
export interface SizeChartRow {
  gender: string;
  category: string; // конкретная категория или 'all'
  size_system: SizeSystem;
  size_label: string;
  chest_min?: number | null; chest_max?: number | null;
  waist_min?: number | null; waist_max?: number | null;
  hip_min?: number | null; hip_max?: number | null;
  height_min?: number | null; height_max?: number | null;
}

export interface Variant {
  id: string;
  color_code: string;
  color_name: string | null;
  size_label: string | null;
  price_thb: number; // сатанги
  in_stock: boolean;
}

export interface Product {
  id: string;
  source_id: string;
  name_en: string;
  name_ru?: string | null;
  gender: Gender | null;
  category: Category | null;
  fit: ProductFit;
  size_system: SizeSystem | null;
  variants: Variant[];
}

export type Confidence = 'high' | 'medium' | 'low';

export interface SizeAdvice {
  size: string;
  alternative?: string;   // соседний размер, если клиент между размерами
  confidence: Confidence;
  reason: string;         // по-русски, показываем клиенту
}

export const ALPHA_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];

/**
 * Приблизительные таблицы Uniqlo (обхваты тела). Заглушка до выгрузки настоящих size_charts с сайта:
 * синхронизация каталога кладёт их в таблицу size_charts, и они заменяют эти значения.
 */
export const DEFAULT_CHARTS: SizeChartRow[] = [
  ...alphaRows('women', [
    ['XS', 76, 82, 58, 64, 82, 88], ['S', 79, 87, 61, 69, 87, 93], ['M', 86, 94, 66, 74, 92, 98],
    ['L', 93, 101, 73, 81, 97, 103], ['XL', 100, 108, 80, 88, 102, 108], ['XXL', 107, 115, 87, 95, 107, 113],
    ['3XL', 114, 122, 94, 102, 112, 118],
  ]),
  ...alphaRows('men', [
    ['XS', 80, 88, 65, 71, 80, 88], ['S', 85, 91, 68, 76, 85, 91], ['M', 88, 96, 76, 84, 88, 96],
    ['L', 96, 104, 84, 94, 96, 104], ['XL', 104, 112, 94, 104, 104, 112], ['XXL', 112, 120, 104, 114, 112, 120],
    ['3XL', 120, 128, 114, 124, 120, 128],
  ]),
  ...[100, 110, 120, 130, 140, 150, 160].map((h) => ({
    gender: 'kids', category: 'all', size_system: 'kids_cm' as SizeSystem, size_label: String(h),
    height_min: h - 5, height_max: h + 4,
  })),
];

function alphaRows(gender: string, rows: [string, number, number, number, number, number, number][]): SizeChartRow[] {
  return rows.map(([size_label, chest_min, chest_max, waist_min, waist_max, hip_min, hip_max]) => ({
    gender, category: 'all', size_system: 'alpha', size_label,
    chest_min, chest_max, waist_min, waist_max, hip_min, hip_max,
  }));
}

type Measure = 'chest' | 'waist' | 'hip';

/** Какие обхваты решают для категории; первый главный. */
const MEASURES_BY_CATEGORY: Record<Category, Measure[]> = {
  tops: ['chest'],
  outerwear: ['chest'],
  innerwear: ['chest', 'waist'],
  dresses: ['chest', 'waist', 'hip'],
  bottoms: ['waist', 'hip'],
  shoes: [],
  accessories: [],
};

/**
 * Обхваты клиента. Если сантиметров нет, оцениваем по российскому размеру
 * (обхват груди ≈ размер × 2), и тогда уверенность ниже.
 */
export function bodyMeasures(p: SizeProfile): { chest?: number; waist?: number; hip?: number; estimated: boolean } {
  const m = { chest: p.chest_cm ?? undefined, waist: p.waist_cm ?? undefined, hip: p.hips_cm ?? undefined, estimated: false };
  if (p.ru_size && (m.chest === undefined || m.waist === undefined || m.hip === undefined)) {
    const base = p.ru_size * 2;
    const est = p.gender === 'men'
      ? { chest: base, waist: base - 12, hip: base + 2 }
      : { chest: base, waist: base - 18, hip: base + 8 };
    if (m.chest === undefined) { m.chest = est.chest; m.estimated = true; }
    if (m.waist === undefined) { m.waist = est.waist; m.estimated = true; }
    if (m.hip === undefined) { m.hip = est.hip; m.estimated = true; }
  }
  return m;
}

function chartFor(charts: SizeChartRow[], gender: string, category: string, system: SizeSystem): SizeChartRow[] {
  const exact = charts.filter((r) => r.gender === gender && r.size_system === system && r.category === category);
  const rows = exact.length ? exact : charts.filter((r) => r.gender === gender && r.size_system === system && r.category === 'all');
  return system === 'alpha'
    ? [...rows].sort((a, b) => ALPHA_ORDER.indexOf(a.size_label) - ALPHA_ORDER.indexOf(b.size_label))
    : [...rows].sort((a, b) => num(a.size_label) - num(b.size_label));
}

function range(row: SizeChartRow, m: Measure): [number, number] | null {
  const lo = row[`${m}_min` as const], hi = row[`${m}_max` as const];
  return lo != null && hi != null ? [lo, hi] : null;
}

/** Насколько обхваты не влезают в размер: 0 — все внутри диапазонов. */
function penalty(row: SizeChartRow, body: Partial<Record<Measure, number>>, measures: Measure[]): number {
  let p = 0;
  measures.forEach((m, i) => {
    const v = body[m], r = range(row, m);
    if (v === undefined || !r) return;
    const out = v < r[0] ? r[0] - v : v > r[1] ? v - r[1] : 0;
    p += out * (i === 0 ? 2 : 1); // главный обхват весит больше
  });
  return p;
}

const RU_LABEL: Record<Measure, string> = { chest: 'груди', waist: 'талии', hip: 'бёдер' };

/** Рекомендованный размер профиля для товара. null — подобрать нельзя (не та аудитория или нет данных). */
export function recommendSize(profile: SizeProfile, product: Product, charts: SizeChartRow[] = DEFAULT_CHARTS): SizeAdvice | null {
  const system = product.size_system ?? 'alpha';
  const audience = product.gender;
  if (audience && audience !== 'unisex' && audience !== profile.gender) return null;
  const available = [...new Set(product.variants.map((v) => v.size_label).filter((l): l is string => !!l))];

  if (system === 'one_size') return { size: available[0] ?? 'ONE SIZE', confidence: 'high', reason: 'Один размер.' };

  if (system === 'waist_inch') {
    const inch = profile.jeans_waist_inch ?? (profile.waist_cm ? Math.round(profile.waist_cm / 2.54) : undefined);
    if (!inch) return null;
    const best = nearest(available, inch);
    if (!best) return null;
    const exact = num(best) === inch;
    return {
      size: best, confidence: profile.jeans_waist_inch ? (exact ? 'high' : 'medium') : 'medium',
      reason: profile.jeans_waist_inch ? `Ваш размер джинсов ${profile.jeans_waist_inch}.` : `Талия ${profile.waist_cm} см ≈ ${inch} дюймов.`,
    };
  }

  if (system === 'shoe_cm') {
    if (!profile.foot_cm) return null;
    const target = Math.ceil(profile.foot_cm * 2) / 2; // вверх до 0,5 см
    const best = smallestAtLeast(available, target);
    if (!best) return null;
    return { size: best, confidence: 'high', reason: `Длина стопы ${profile.foot_cm} см.` };
  }

  if (system === 'kids_cm') {
    if (!profile.height_cm) return null;
    // детские размеры Uniqlo = рост; берём ближайший не меньше роста, чтобы был запас
    const best = smallestAtLeast(available, profile.height_cm - 4);
    if (!best) return null;
    return { size: best, confidence: 'high', reason: `Рост ${profile.height_cm} см.` };
  }

  // alpha
  const category = product.category ?? 'tops';
  const measures = MEASURES_BY_CATEGORY[category];
  const rows = chartFor(charts, profile.gender, category, 'alpha').filter((r) => available.includes(r.size_label));
  const body = bodyMeasures(profile);
  const known = measures.filter((m) => body[m] !== undefined);
  const pref = profile.fit_preference ?? 'regular';

  if (!rows.length || !known.length) {
    const usual = category === 'bottoms' ? profile.usual_bottom : profile.usual_top;
    if (usual && available.includes(usual)) {
      return { size: usual, confidence: 'medium', reason: `Ваш обычный размер ${usual}. Добавьте обхваты в профиль, чтобы подбор был точнее.` };
    }
    return null;
  }

  const scored = rows.map((r, i) => ({ r, i, p: penalty(r, body, known) }));
  const minP = Math.min(...scored.map((s) => s.p));
  const fits = scored.filter((s) => s.p === minP);
  // Между размерами: «облегающе» — меньший, «свободно» — больший, иначе ближе к середине по главному обхвату.
  let pick = fits[0];
  if (fits.length > 1) {
    if (pref === 'tight') pick = fits[0];
    else if (pref === 'oversize') pick = fits[fits.length - 1];
    else {
      const m = known[0], v = body[m]!;
      pick = [...fits].sort((a, b) => centerDist(a.r, m, v) - centerDist(b.r, m, v))[0];
    }
  } else if (pref === 'oversize' && product.fit !== 'oversized' && scored[pick.i + 1]) {
    pick = scored[pick.i + 1]; // свободная посадка у обычной вещи — на размер больше
  }

  const alt = fits.length > 1 ? fits.find((f) => f !== pick)?.r.size_label : undefined;
  const parts = known.map((m) => `обхват ${RU_LABEL[m]} ${body[m]} см`);
  let reason = `По таблице Uniqlo: ${parts.join(', ')}${body.estimated ? ' (оценка по российскому размеру)' : ''}.`;
  if (minP > 0) reason += ' Ваши мерки за пределами таблицы, лучше уточнить у Алии.';
  if (alt) reason += ` Вы между размерами, ${alt} сядет ${ALPHA_ORDER.indexOf(alt) > ALPHA_ORDER.indexOf(pick.r.size_label) ? 'свободнее' : 'плотнее'}.`;
  if (product.fit === 'oversized' && pref !== 'oversize') reason += ' Модель оверсайз, она и так свободная.';
  if (product.fit === 'slim' && pref === 'oversize') reason += ' Модель приталенная.';

  const confidence: Confidence = minP > 0 || body.estimated ? 'low' : alt ? 'medium' : 'high';
  return { size: pick.r.size_label, alternative: alt, confidence, reason };
}

function centerDist(r: SizeChartRow, m: Measure, v: number): number {
  const rg = range(r, m);
  return rg ? Math.abs((rg[0] + rg[1]) / 2 - v) : 0;
}

/** Числовые размеры в каталоге бывают с единицами: '27inch', '23.5cm', '110'. */
export const num = (label: string) => parseFloat(label);

function nearest(labels: string[], target: number): string | undefined {
  return labels.filter((l) => !Number.isNaN(num(l)))
    .sort((a, b) => Math.abs(num(a) - target) - Math.abs(num(b) - target) || num(a) - num(b))[0];
}

/** Самый маленький размер из списка не меньше min. */
function smallestAtLeast(labels: string[], min: number): string | undefined {
  return labels.filter((l) => num(l) >= min).sort((a, b) => num(a) - num(b))[0];
}

export interface Match {
  product: Product;
  advice: SizeAdvice;
  colorsInStock: { color_code: string; color_name: string | null; variant_id: string; price_thb: number }[];
}

/**
 * Фильтр «есть мой размер»: товары, в которых рекомендованный размер профиля есть в наличии
 * хотя бы в одном цвете. Порядок как во входном списке.
 */
export function matchCatalog(profile: SizeProfile, products: Product[], charts: SizeChartRow[] = DEFAULT_CHARTS): Match[] {
  const out: Match[] = [];
  for (const product of products) {
    const advice = recommendSize(profile, product, charts);
    if (!advice) continue;
    const colorsInStock = product.variants
      .filter((v) => v.in_stock && v.size_label === advice.size)
      .map((v) => ({ color_code: v.color_code, color_name: v.color_name, variant_id: v.id, price_thb: v.price_thb }));
    if (colorsInStock.length) out.push({ product, advice, colorsInStock });
  }
  return out;
}
