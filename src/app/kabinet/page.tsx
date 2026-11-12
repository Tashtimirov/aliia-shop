import type { Metadata } from 'next';
import { connection } from 'next/server';
import { KabinetView } from '@/components/kabinet-view';
import { aiEnabled } from '@/lib/kabinet/ai';

export const metadata: Metadata = { title: 'Мой кабинет — Aliia Buyer' };

export default async function KabinetPage() {
  await connection(); // ключ ИИ читаем при запросе, а не при сборке
  return <KabinetView aiOn={aiEnabled()} />;
}
