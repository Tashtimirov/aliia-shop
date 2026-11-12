import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GENDERS, getPricing, getProduct } from '@/lib/catalog';
import { VariantPicker } from '@/components/variant-picker';

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [data, pricing] = await Promise.all([getProduct(id), getPricing()]);
  if (!data) notFound();
  const { item, variants } = data;
  return (
    <div className="space-y-4">
      <Link href="/" className="text-sm text-[var(--muted)]">← Каталог</Link>
      <VariantPicker item={item} variants={variants} pricing={pricing} />
      <div className="space-y-1 text-xs text-[var(--muted)]">
        <div>Артикул {item.source_id}{item.gender ? ` · ${GENDERS[item.gender] ?? item.gender}` : ''}</div>
        <a href={item.source_url} target="_blank" rel="noreferrer" className="underline">Эта вещь на сайте Uniqlo Таиланд</a>
      </div>
    </div>
  );
}
