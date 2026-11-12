'use client';

import { useEffect } from 'react';

type TgWebApp = { initData: string; ready: () => void; expand: () => void; colorScheme?: 'light' | 'dark' };
declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export const telegramInitData = () => (typeof window !== 'undefined' ? window.Telegram?.WebApp?.initData || '' : '');

/** Сообщает Telegram, что Mini App готов, и разворачивает его на весь экран. На обычном сайте ничего не делает. */
export function TelegramReady() {
  useEffect(() => {
    const app = window.Telegram?.WebApp;
    if (app?.initData) {
      app.ready();
      app.expand();
    }
  }, []);
  return null;
}
