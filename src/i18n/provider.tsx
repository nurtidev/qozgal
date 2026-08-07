'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';

import { getWebApp } from '@/lib/telegram/client';
import ru from './messages/ru.json';
import kk from './messages/kk.json';

export const MESSAGES = { ru, kk };
export type Locale = keyof typeof MESSAGES;

/**
 * Язык интерфейса берётся из language_code Telegram — из того же поля,
 * по которому бот проставляет `locale` пользователю в базе. Спрашивать
 * язык отдельным экраном не нужно: человек уже выбрал его в клиенте.
 *
 * Всё, что не казахский, считаем русским: третьего языка в интерфейсе нет,
 * а англоязычный клиент у нашей аудитории почти всегда означает русский.
 */
export function detectLocale(): Locale {
  const code = getWebApp()?.initDataUnsafe?.user?.language_code ?? '';
  return code.toLowerCase().startsWith('kk') ? 'kk' : 'ru';
}

/**
 * Язык определяется после гидратации, а не при первом рендере.
 *
 * Страницы отдаются статикой, и серверу неоткуда узнать пользователя:
 * подпись Telegram приходит только в заголовке запроса к API. Выбор языка
 * прямо в первом рендере разошёлся бы с разметкой сервера и сломал
 * гидратацию, поэтому первый кадр русский. Видно это не бывает: до ответа
 * API на экране всё равно крутится спиннер.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('ru');

  useEffect(() => {
    const next = detectLocale();
    if (next !== 'ru') setLocale(next);
    document.documentElement.lang = next;
  }, []);

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      // Часовой пояс телефона: без него next-intl предупреждает о
      // несовпадении сервера и клиента при форматировании дат
      timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
    >
      {children}
    </NextIntlClientProvider>
  );
}

/** Локаль форматирования дат и чисел для выбранного языка */
export function intlLocale(locale: Locale): string {
  return locale === 'kk' ? 'kk-KZ' : 'ru-RU';
}
