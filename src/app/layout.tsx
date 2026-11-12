import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import Script from 'next/script';
import { Inter } from 'next/font/google';
import { CartBadge, CartProvider } from '@/components/cart';
import { TelegramReady } from '@/components/telegram';
import './globals.css';

const inter = Inter({ variable: '--font-inter', subsets: ['latin', 'cyrillic'] });

export const metadata: Metadata = {
  title: 'Aliia Buyer — Uniqlo из Таиланда',
  description: 'Заказ вещей Uniqlo из Таиланда с доставкой в Россию. Цены в рублях, выкуп в день заказа.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <head>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      </head>
      <body className={`${inter.variable} antialiased`}>
        <CartProvider>
          <TelegramReady />
          <header className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--background)]/95 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                Aliia <span className="text-[var(--accent)]">Buyer</span>
              </Link>
              <Link href="/cart" className="text-sm font-medium">
                <CartBadge />
              </Link>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-4">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 py-8 text-xs leading-relaxed text-[var(--muted)]">
            Aliia Buyer — независимый байер в Бангкоке, не связан с Uniqlo. Вещи выкупаются в официальных магазинах Uniqlo Таиланда.
            Цена на карточке включает выкуп и комиссию, доставка считается отдельно. Наличие в магазине может отличаться от сайта:
            если вещи не окажется, Алия предложит замену или вернёт деньги. При заказе дороже 200 € в одной посылке возможна пошлина.
          </footer>
        </CartProvider>
      </body>
    </html>
  );
}
