import { createTranslator } from 'next-intl';

import ru from './messages/ru.json';
import kk from './messages/kk.json';

/**
 * Словари и выбор языка — общее место для всех сторон приложения.
 *
 * Тексты интерфейса, бота и ошибок API лежат в одних файлах намеренно:
 * пользователь видит их в одном разговоре, и расхождение в словах между
 * карточкой в боте и тем же экраном в Mini App читается как небрежность.
 */
export const MESSAGES = { ru, kk };

export type Locale = keyof typeof MESSAGES;

/**
 * Приводит `language_code` из Telegram или `locale` из базы к поддерживаемому
 * языку. Всё, что не казахский, считаем русским: третьего языка в приложении
 * нет, а англоязычный клиент у нашей аудитории почти всегда означает русский.
 */
export function toLocale(value: string | null | undefined): Locale {
  return value?.toLowerCase().startsWith('kk') ? 'kk' : 'ru';
}

/** Локаль форматирования дат и чисел для выбранного языка */
export function intlLocale(locale: Locale): string {
  return locale === 'kk' ? 'kk-KZ' : 'ru-RU';
}

/**
 * Переводчик вне React — для бота и обработчиков API.
 *
 * Ключ берётся целиком, вместе с пространством имён: `t('bot.saved')`.
 */
export function translator(locale: Locale) {
  return createTranslator({ locale, messages: MESSAGES[locale] });
}
