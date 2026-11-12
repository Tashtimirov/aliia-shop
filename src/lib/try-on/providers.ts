// Провайдеры примерки через fal.ai. Ключ FAL_KEY только на сервере.
// FASHN v1.6: 0,075 $ за картинку, принимает фото товара на модели и флэтлэй, категорию.
// Kling Kolors v1.5: 0,07 $ за картинку, запасной вариант.

export type GarmentCategory = 'tops' | 'bottoms' | 'one-pieces' | 'auto';

export interface TryOnRequest {
  personImageUrl: string;   // подписанная ссылка на фото клиента (или прошлую примерку)
  garmentImageUrl: string;  // фото товара из каталога
  category: GarmentCategory;
  garmentPhotoType: 'flat-lay' | 'model' | 'auto';
}

export interface TryOnProvider {
  name: 'fashn' | 'kling';
  costUsd: number;
  run(req: TryOnRequest): Promise<{ imageUrl: string }>;
}

type FetchFn = typeof fetch;
type FalOutput = { images?: { url?: string }[]; image?: { url?: string } } | null;

async function callFal(fetchFn: FetchFn, key: string, model: string, body: unknown, timeoutMs: number) {
  const res = await fetchFn(`https://fal.run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`fal ${model}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<FalOutput>;
}

export function fashn(key: string, mode: 'performance' | 'balanced' | 'quality' = 'balanced', fetchFn: FetchFn = fetch): TryOnProvider {
  return {
    name: 'fashn',
    costUsd: 0.075,
    async run(r) {
      const out = await callFal(fetchFn, key, 'fal-ai/fashn/tryon/v1.6', {
        model_image: r.personImageUrl,
        garment_image: r.garmentImageUrl,
        category: r.category,
        garment_photo_type: r.garmentPhotoType,
        mode,
        moderation_level: 'permissive',
        output_format: 'jpeg',
        num_samples: 1,
      }, 90_000);
      const url = out?.images?.[0]?.url;
      if (!url) throw new Error('fal fashn: пустой ответ');
      return { imageUrl: url };
    },
  };
}

export function kling(key: string, fetchFn: FetchFn = fetch): TryOnProvider {
  return {
    name: 'kling',
    costUsd: 0.07,
    async run(r) {
      const out = await callFal(fetchFn, key, 'fal-ai/kling/v1-5/kolors-virtual-try-on', {
        human_image_url: r.personImageUrl,
        garment_image_url: r.garmentImageUrl,
      }, 120_000);
      const url = out?.image?.url;
      if (!url) throw new Error('fal kling: пустой ответ');
      return { imageUrl: url };
    },
  };
}
