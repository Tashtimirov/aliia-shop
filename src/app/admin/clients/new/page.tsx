import { requireAdmin } from '@/lib/crm/auth';
import { ClientForm } from '@/components/crm/client-form';

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ then?: string }> }) {
  await requireAdmin();
  const { then } = await searchParams;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Новый клиент</h1>
      <ClientForm then={then === 'order' ? 'order' : undefined} />
    </div>
  );
}
