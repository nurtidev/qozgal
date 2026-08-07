import { z } from 'zod';
import { getSession, AuthError, type Session } from './auth';

/**
 * Обвязка для обработчиков API.
 *
 * Каждый роут начинается с проверки подписи Telegram, поэтому вынесено сюда:
 * забытая проверка в одном обработчике означала бы, что чужой дневник читается
 * по одному лишь идентификатору. Личность всегда берётся из session.user,
 * никогда из тела запроса.
 */
export type Handler<T> = (ctx: {
  session: Session;
  request: Request;
  params: T;
}) => Promise<Response>;

export function route<T = Record<string, never>>(handler: Handler<T>) {
  return async (
    request: Request,
    context: { params: Promise<T> } = { params: Promise.resolve({} as T) },
  ): Promise<Response> => {
    try {
      const session = await getSession(request);
      const params = await context.params;
      return await handler({ session, request, params });
    } catch (error) {
      return toResponse(error);
    }
  };
}

function toResponse(error: unknown): Response {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }

  if (error instanceof z.ZodError) {
    // Сообщение собирается по полям, чтобы клиент мог подсветить конкретное
    // поле формы, а не показывать общее «что-то не так».
    const fields: Record<string, string> = {};
    for (const issue of error.issues) {
      fields[issue.path.join('.') || '_'] = issue.message;
    }
    return Response.json(
      { error: 'Некорректные данные', fields },
      { status: 422 },
    );
  }

  console.error('Необработанная ошибка API:', error);
  return Response.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
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
      { code: 'custom', path: ['_'], message: 'Ожидался JSON' },
    ]);
  }
  return schema.parse(raw);
}

/** Дата в формате YYYY-MM-DD */
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Ожидается дата в формате ГГГГ-ММ-ДД');
