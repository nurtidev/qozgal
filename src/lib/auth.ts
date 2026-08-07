import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users, profiles, type User, type Profile } from '@/db/schema';
import { env } from '@/env';
import {
  validateInitData,
  extractInitData,
  type TelegramUser,
} from './telegram/init-data';
import { toLocale, translator } from '@/i18n/messages';

/**
 * Ошибка авторизации. В `message` лежит ключ словаря, а не готовая фраза:
 * язык пользователя известен только после успешной проверки подписи,
 * и перевод делает обвязка API.
 */
export class AuthError extends Error {
  constructor(
    message: string,
    readonly status = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface Session {
  user: User;
  profile: Profile | null;
  /** true — онбординг не пройден, физданные ещё не заполнены */
  needsOnboarding: boolean;
}

/**
 * Создаёт пользователя при первом входе, при последующих — обновляет
 * профиль из Telegram (имя и аватар там меняются) и отметку активности.
 */
async function upsertUser(tgUser: TelegramUser): Promise<User> {
  const telegramId = BigInt(tgUser.id);
  const now = new Date();

  const [row] = await db
    .insert(users)
    .values({
      telegramId,
      username: tgUser.username ?? null,
      firstName: tgUser.first_name ?? null,
      lastName: tgUser.last_name ?? null,
      photoUrl: tgUser.photo_url ?? null,
      locale: toLocale(tgUser.language_code),
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: {
        username: tgUser.username ?? null,
        firstName: tgUser.first_name ?? null,
        lastName: tgUser.last_name ?? null,
        photoUrl: tgUser.photo_url ?? null,
        // Язык обновляется на каждом входе: человек, переключивший клиент
        // Telegram на казахский, ожидает казахский и от нас. Своего выбора
        // языка в приложении нет, перетирать нечего.
        locale: toLocale(tgUser.language_code),
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .returning();

  return row;
}

/**
 * Единственный способ узнать, кто прислал запрос.
 *
 * Личность берётся исключительно из подписанного Telegram initData.
 * Никакой telegram_id или user_id из тела запроса и параметров URL
 * не используется — иначе любой мог бы читать чужие дневники.
 *
 * @throws AuthError если подпись отсутствует, неверна или устарела
 */
export async function getSession(request: Request): Promise<Session> {
  const raw = extractInitData(request.headers.get('authorization'));
  if (!raw) {
    throw new AuthError('errors.auth.missing');
  }

  const result = validateInitData(raw, env.TELEGRAM_BOT_TOKEN);
  if (!result.ok) {
    throw new AuthError(`errors.auth.${result.reason}`);
  }

  const user = await upsertUser(result.data.user);
  if (user.isBlocked) {
    throw new AuthError('errors.auth.blocked', 403);
  }

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  return {
    user,
    profile: profile ?? null,
    needsOnboarding: !profile,
  };
}

/** Сессия с гарантированно заполненным профилем — для расчётных ручек */
export async function requireProfile(
  request: Request,
): Promise<Session & { profile: Profile }> {
  const session = await getSession(request);
  if (!session.profile) {
    throw new AuthError('errors.needProfile', 428);
  }
  return session as Session & { profile: Profile };
}

/** Приводит любую ошибку к JSON-ответу, не раскрывая внутренностей */
export function toErrorResponse(error: unknown): Response {
  const t = translator('ru');

  if (error instanceof AuthError) {
    return Response.json(
      { error: t.has(error.message as 'errors.internal') ? t(error.message as 'errors.internal') : error.message },
      { status: error.status },
    );
  }

  console.error('Необработанная ошибка API:', error);
  return Response.json({ error: t('errors.internal') }, { status: 500 });
}

/** Отдельная авторизация бота: сверяем секрет вебхука от Telegram */
export function isValidWebhookSecret(request: Request): boolean {
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) return true; // секрет не настроен — проверять нечего
  return (
    request.headers.get('x-telegram-bot-api-secret-token') === expected
  );
}
