import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    <html lang="ru">
      <head>
        {/* Скрипт Telegram обязан загрузиться до гидратации: клиентский код
            читает window.Telegram.WebApp при первом рендере. Атрибут async
            здесь неуместен — порядок важнее скорости. */}
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body className="min-h-screen bg-[var(--tg-theme-bg-color)] text-[var(--tg-theme-text-color)]">
        {children}
      </body>
    </html>
  );
}
