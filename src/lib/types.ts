export type Gender = 'women' | 'men' | 'kids' | 'baby' | 'unisex';

export type ProductImage = { url: string; color_code: string | null; kind: 'main' | 'model' | 'flat' | 'detail' };

export type CatalogItem = {
  id: string;
  brand_id: string;
  source_id: string;
  name_en: string;
  name_ru: string | null;
  gender: Gender | null;
  category: string | null;
  source_url: string;
  images: ProductImage[];
  size_system: string | null;
  rating: number | null;
  min_price_thb: number | null;
  any_min_price_thb: number | null;
  max_base_price_thb: number | null;
  has_stock: boolean | null;
  on_sale: boolean | null;
};

export type Variant = {
  id: string;
  product_id: string;
  sku: string | null;
  color_code: string;
  color_name: string | null;
  size_code: string;
  size_label: string | null;
  price_thb: number;
  base_price_thb: number;
  in_stock: boolean;
};

export type Pricing = {
  thb_rub: number;
  commission_pct: number;
  commission_min_rub: number;
  delivery_rub_per_kg?: number;
};

export type CartLine = {
  variant_id: string;
  product_id: string;
  source_id: string;
  name: string;
  color: string;
  size: string;
  image_url: string | null;
  url: string;
  price_thb: number;
  qty: number;
};
