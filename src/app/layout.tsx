import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/i18n/provider';

export const metadata: Metadata = {
  title: 'Qozgal — дневник питания',
  description: 'Трекер еды с распознаванием по фото',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Масштабирование выключено: в Mini App двойной тап по числу приводил бы
  // к зуму вместо правки значения
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Палитру Telegram переносит в CSS applyTheme(), проставляя переменные
    // прямо на <html> — то есть разметка корня заведомо расходится с той,
    // что пришла с сервера. Без этой пометки React ругается на каждый вход
    // в приложение, и настоящие расхождения тонут в этом шуме.
    <html lang="ru" suppressHydrationWarning>
      <head>
        {/* Скрипт Telegram обязан загрузиться до гидратации: клиентский код
            читает window.Telegram.WebApp при первом рендере. Атрибут async
            здесь неуместен — порядок важнее скорости. */}
        <script src="https://telegram.org/js/telegram-web-app.js" />

        {/* Кириллица подгружается заранее: без этого первый кадр приложения
            рисуется системным шрифтом и через мгновение переверстывается
            своим — заметнее всего на крупных числах дашборда. Латиница
            в предзагрузке не нужна, на первом экране её почти нет. */}
        <link
          rel="preload"
          href="/fonts/plex-cyrillic.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-screen bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
        {/* Язык уточняется после гидратации: серверу пользователь неизвестен,
            подпись Telegram приходит только в заголовке запроса к API */}
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
