import type messages from './messages/ru.json';

/**
 * Типизация ключей перевода.
 *
 * Русский словарь объявлен эталонным: опечатка в t('weigth.title') станет
 * ошибкой сборки, а не пустой строкой на экране у пользователя. Совпадение
 * набора ключей русского и казахского проверяется юнит-тестом — типы за
 * этим не следят.
 */
declare module 'next-intl' {
  interface AppConfig {
    Messages: typeof messages;
    Locale: 'ru' | 'kk';
  }
}
