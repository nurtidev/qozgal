import { z } from 'zod';

/**
 * Переменные окружения валидируются один раз при старте, а не в момент
 * первого обращения: лучше упасть на деплое, чем отдать пользователю 500
 * посреди разбора фотографии.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().url(),

  /** Токен бота от @BotFather. Им же подписывается initData Mini App. */
  TELEGRAM_BOT_TOKEN: z.string().min(20),
  /** Секрет для заголовка X-Telegram-Bot-Api-Secret-Token на вебхуке */
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).optional(),

  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),

  /** Ключ USDA FoodData Central; при отсутствии остаётся только локальный справочник */
  USDA_API_KEY: z.string().optional(),

  // Своего хранилища фотографий нет намеренно. Снимок нужен ровно один раз —
  // на распознавание, дальше ценность несут разобранные позиции. В базе лежит
  // ссылка на файл в Telegram (tg:<file_id>), а не сам файл: это ноль
  // инфраструктуры и, что важнее, никаких персональных данных на нашей стороне.

  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
});

const clientSchema = z.object({
  /** Публичный адрес Mini App — нужен боту для кнопки запуска */
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

function parseEnv() {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Некорректные переменные окружения:\n${issues}`);
  }
  return parsed.data;
}

/** Серверное окружение. Обращаться только из серверного кода. */
export const env = parseEnv();

export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
