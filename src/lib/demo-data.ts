// Демо-данные, чтобы витрина открывалась без базы (локальная разработка, превью).
// Настоящий каталог грузится в Supabase скриптом scripts/catalog-sync/load-to-supabase.mjs.
import type { CatalogItem, Variant } from './types';

type Seed = { id: string; name: string; gender: CatalogItem['gender']; category: string; base: number; price: number; colors: [string, string][]; sizes: string[]; oos?: string[] };

const seeds: Seed[] = [
  { id: 'DEMO-001', name: 'Puffer Jacket (демо)', gender: 'women', category: 'outerwear', base: 2990, price: 2490, colors: [['09', 'BLACK'], ['31', 'BEIGE']], sizes: ['XS', 'S', 'M', 'L', 'XL'], oos: ['09-XS'] },
  { id: 'DEMO-002', name: 'Heattech Turtleneck T-Shirt (демо)', gender: 'women', category: 'tops', base: 590, price: 590, colors: [['09', 'BLACK'], ['01', 'OFF WHITE']], sizes: ['S', 'M', 'L'] },
  { id: 'DEMO-003', name: 'Wide Straight Jeans (демо)', gender: 'women', category: 'bottoms', base: 1490, price: 990, colors: [['64', 'BLUE']], sizes: ['24inch', '25inch', '26inch', '27inch'] },
  { id: 'DEMO-004', name: 'Sweat Full-Zip Hoodie (демо)', gender: 'men', category: 'tops', base: 1290, price: 1290, colors: [['08', 'DARK GRAY'], ['69', 'NAVY']], sizes: ['S', 'M', 'L', 'XL', 'XXL'] },
  { id: 'DEMO-005', name: 'Ultra Light Down Vest (демо)', gender: 'unisex', category: 'outerwear', base: 1490, price: 1290, colors: [['09', 'BLACK']], sizes: ['XS', 'S', 'M', 'L', 'XL'], oos: ['09-M'] },
  { id: 'DEMO-006', name: 'Kids Fleece Jacket (демо)', gender: 'kids', category: 'outerwear', base: 790, price: 590, colors: [['12', 'RED']], sizes: ['110', '120', '130', '140'] },
];

export const demoVariants: Variant[] = seeds.flatMap((s) =>
  s.colors.flatMap(([code, name]) =>
    s.sizes.map((size) => ({
      id: `${s.id}-${code}-${size}`,
      product_id: s.id,
      sku: null,
      color_code: code,
      color_name: name,
      size_code: size,
      size_label: size,
      price_thb: s.price * 100,
      base_price_thb: s.base * 100,
      in_stock: !s.oos?.includes(`${code}-${size}`),
    })),
  ),
);

export const demoItems: CatalogItem[] = seeds.map((s) => ({
  id: s.id,
  brand_id: 'uniqlo',
  source_id: s.id,
  name_en: s.name,
  name_ru: null,
  gender: s.gender,
  category: s.category,
  source_url: 'https://www.uniqlo.com/th/en/',
  images: [],
  size_system: /inch/.test(s.sizes[0]) ? 'waist_inch' : /^\d+$/.test(s.sizes[0]) ? 'kids_cm' : 'alpha',
  rating: null,
  min_price_thb: s.price * 100,
  any_min_price_thb: s.price * 100,
  max_base_price_thb: s.base * 100,
  has_stock: true,
  on_sale: s.price < s.base,
}));
