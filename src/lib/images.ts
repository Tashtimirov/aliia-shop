import type { CatalogItem } from './types';

export function mainImage(item: CatalogItem, colorCode?: string): string | null {
  const imgs = item.images ?? [];
  return (colorCode && imgs.find((i) => i.color_code === colorCode)?.url) || imgs.find((i) => i.kind === 'main')?.url || imgs[0]?.url || null;
}
