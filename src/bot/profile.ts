import type { Api } from 'grammy';
import type { LanguageCode } from 'grammy/types';

import { translator, type Locale } from '@/i18n/messages';

/**
 * Публичное лицо бота: описание, короткое описание и список команд.
 *
 * Описание — единственное, что человек видит до первого нажатия «Начать»:
 * Telegram показывает его на экране «Что умеет этот бот» и больше нигде.
 * Пока оно пустое, новый пользователь открывает пустой чат и должен сам
 * догадаться, что боту надо прислать фотографию тарелки. Приветствие после
 * /start это объясняет, но до него доходит не каждый.
 *
 * Ставится кодом, а не руками в BotFather, по той же причине, что миграции
 * не накатывают из консоли: иначе через полгода никто не помнит, какой
 * текст там стоит и почему, а на казахском его вообще забыли завести.
 *
 * Языки: без language_code значение становится общим для всех, поэтому
 * русский идёт значением по умолчанию, а казахский — отдельным вызовом.
 */
const LOCALES: { locale: Locale; languageCode?: LanguageCode }[] = [
  { locale: 'ru' },
  { locale: 'kk', languageCode: 'kk' },
];

const COMMANDS = ['start', 'today', 'app'] as const;

/** Ограничения Telegram: описание 512 символов, короткое — 120 */
const MAX_DESCRIPTION = 512;
const MAX_SHORT_DESCRIPTION = 120;

export async function publishProfile(api: Api): Promise<void> {
  for (const { locale, languageCode } of LOCALES) {
    const t = translator(locale);
    const scope = languageCode ? { language_code: languageCode } : {};

    const description = t('bot.profile.description');
    const short = t('bot.profile.short');

    // Обрезать молча нельзя: Telegram вернёт ошибку и профиль останется
    // прежним, а мы этого не заметим — лучше упасть на старте
    if (description.length > MAX_DESCRIPTION) {
      throw new Error(
        `Описание бота (${locale}) длиннее ${MAX_DESCRIPTION} символов: ${description.length}`,
      );
    }
    if (short.length > MAX_SHORT_DESCRIPTION) {
      throw new Error(
        `Короткое описание бота (${locale}) длиннее ${MAX_SHORT_DESCRIPTION} символов: ${short.length}`,
      );
    }

    await api.setMyDescription(description, scope);
    await api.setMyShortDescription(short, scope);
    await api.setMyCommands(
      COMMANDS.map((command) => ({
        command,
        description: t(`bot.commands.${command}`),
      })),
      scope,
    );
  }
}
