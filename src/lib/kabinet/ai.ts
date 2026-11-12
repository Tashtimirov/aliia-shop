// ИИ-подборка для личного кабинета (Claude API).
// Сначала код сам отбирает товары, где у клиента есть размер в наличии (matchCatalog),
// а Claude только выбирает из этого списка и объясняет по-русски. Так ИИ не советует то, чего нет.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { Match, SizeProfile } from './sizing';

export const MODEL = 'claude-opus-5-5';

const PicksSchema = z.object({
  summary: z.string().describe('1–2 предложения для клиента, по-русски'),
  picks: z.array(z.object({
    product_id: z.string(),
    size_label: z.string(),
    color_code: z.string(),
    reason: z.string().describe('почему подходит, одно предложение по-русски'),
  })),
});
export type Picks = z.infer<typeof PicksSchema>;

const SYSTEM = `Ты стилист сервиса байера Алии: она выкупает вещи в магазинах Uniqlo в Бангкоке и отправляет клиентам в Россию.
Подбирай вещи только из списка кандидатов. Размер и цвет бери только из тех, что указаны у кандидата: это размер клиента, который есть в наличии.
Учитывай запрос клиента, бюджет в рублях, пометки о стиле и климат в городе доставки. Если просят комплект, собирай вещи, которые сочетаются.
Пиши по-русски, коротко и по-дружески, без канцелярита. Не обещай наличие в магазине: онлайн-наличие и наличие в Бангкоке могут отличаться.`;

export interface RecommendInput {
  profile: SizeProfile;
  candidates: Match[];      // из matchCatalog, обычно 30–80 штук после фильтра по категории и бюджету
  request: string;          // «тёплый комплект до 10 000 ₽»; пусто — «подбери что-нибудь для меня»
  priceRub: (thbSatang: number) => number; // формула цены из settings.pricing
  city?: string | null;
  maxPicks?: number;
}

/** Без ANTHROPIC_API_KEY в окружении ИИ-подбор выключен, остальной кабинет работает. */
export const aiEnabled = () => !!process.env.ANTHROPIC_API_KEY;

export async function recommend(input: RecommendInput, client = new Anthropic()) {
  const { profile, candidates, priceRub, maxPicks = 6 } = input;
  const list = candidates.map((m) => ({
    product_id: m.product.id,
    name: m.product.name_ru || m.product.name_en,
    category: m.product.category,
    fit: m.product.fit,
    size: m.advice.size,
    size_confidence: m.advice.confidence,
    colors: m.colorsInStock.map((c) => ({ color_code: c.color_code, color: c.color_name, price_rub: priceRub(c.price_thb) })),
  }));
  const who = {
    label: profile.label, gender: profile.gender, height_cm: profile.height_cm, fit_preference: profile.fit_preference,
    style_notes: profile.style_notes, city: input.city,
  };

  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // если модель откажет по политике, API сам повторит запрос на запасной модели
    output_config: { effort: 'low', format: betaZodOutputFormat(PicksSchema) },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `Клиент: ${JSON.stringify(who)}\n\nКандидаты (уже в размере клиента и в наличии):\n${JSON.stringify(list)}\n\n` +
        `Запрос клиента: ${input.request.trim() || 'подбери что-нибудь мне по стилю'}\n\nВыбери до ${maxPicks} вещей.`,
    }],
  });

  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    return { picks: [], summary: 'Не получилось подобрать автоматически, напишите Алии, она поможет.', usage: response.usage };
  }

  // Страховка: оставляем только товары/размеры/цвета, которые реально были в списке.
  const byId = new Map(candidates.map((m) => [m.product.id, m]));
  const picks = response.parsed_output.picks.filter((p) => {
    const m = byId.get(p.product_id);
    return m && m.advice.size === p.size_label && m.colorsInStock.some((c) => c.color_code === p.color_code);
  }).slice(0, maxPicks);

  return { picks, summary: response.parsed_output.summary, usage: response.usage };
}
