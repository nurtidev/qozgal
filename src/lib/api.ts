import { z } from 'zod';
import { getSession, AuthError, type Session } from './auth';
import { translator, toLocale, type Locale } from '@/i18n/messages';

/**
 * Обвязка для обработчиков API.
 *
 * Каждый роут начинается с проверки подписи Telegram, поэтому вынесено сюда:
 * забытая проверка в одном обработчике означала бы, что чужой дневник читается
 * по одному лишь идентификатору. Личность всегда берётся из session.user,
 * никогда из тела запроса.
 *
 * Здесь же определяется язык ответа. Сообщения об ошибках попадают человеку
 * на экран рядом с полем формы, и русская фраза в казахском интерфейсе
 * выглядит как сбой приложения, а не как подсказка.
 */
export type Translator = ReturnType<typeof translator>;

export type Handler<T> = (ctx: {
  session: Session;
  request: Request;
  params: T;
  /** Переводчик на языке пользователя: `t('errors.entryNotFound')` */
  t: Translator;
}) => Promise<Response>;

export function route<T = Record<string, never>>(handler: Handler<T>) {
  return async (
    request: Request,
    context: { params: Promise<T> } = { params: Promise.resolve({} as T) },
  ): Promise<Response> => {
    // До проверки подписи язык неизвестен: она и есть единственный источник
    // сведений о том, кто пришёл. Ошибки авторизации остаются на русском.
    let locale: Locale = 'ru';

    try {
      const session = await getSession(request);
      locale = toLocale(session.user.locale);
      const params = await context.params;
      return await handler({ session, request, params, t: translator(locale) });
    } catch (error) {
      return toResponse(error, locale);
    }
  };
}

function toResponse(error: unknown, locale: Locale): Response {
  const t = translator(locale);

  if (error instanceof AuthError) {
    return Response.json(
      { error: maybeTranslate(t, error.message) },
      { status: error.status },
    );
  }

  if (error instanceof z.ZodError) {
    // Сообщение собирается по полям, чтобы клиент мог подсветить конкретное
    // поле формы, а не показывать общее «что-то не так».
    const fields: Record<string, string> = {};
    for (const issue of error.issues) {
      fields[issue.path.join('.') || '_'] = maybeTranslate(t, issue.message);
    }
    return Response.json(
      { error: t('errors.invalidData'), fields },
      { status: 422 },
    );
  }

  console.error('Необработанная ошибка API:', error);
  return Response.json({ error: t('errors.internal') }, { status: 500 });
}

/**
 * Переводит сообщение, если это ключ словаря.
 *
 * Свои сообщения задаются ключами (`errors.heightTooLow`), но zod умеет
 * подставлять и собственные фразы — например, когда в теле пришёл не тот
 * тип. Такие проходят как есть: показать английский текст неприятно,
 * потерять описание ошибки хуже.
 */
function maybeTranslate(t: Translator, message: string): string {
  const key = message as Parameters<typeof t.has>[0];
  return t.has(key) ? t(key) : message;
}

/** Разбирает и валидирует тело запроса; ошибка превратится в 422 с полями */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new z.ZodError([
      { code: 'custom', path: ['_'], message: 'errors.expectedJson' },
    ]);
  }
  return schema.parse(raw);
}

/** Дата в формате YYYY-MM-DD */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'errors.expectedDate');
