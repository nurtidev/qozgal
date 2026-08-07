import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { route, parseBody, dateSchema } from '@/lib/api';
import { db } from '@/db';
import { injuries } from '@/db/schema';
import { localDate } from '@/db/queries';

type Params = { id: string };

const patchSchema = z.object({
  severity: z.enum(['watch', 'pain', 'medical']).optional(),
  /** Дата выздоровления; null снова открывает травму */
  resolvedOn: dateSchema.nullable().optional(),
  /** true — закрыть сегодняшней датой, короткий путь для кнопки «прошло» */
  resolve: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
});

export const PATCH = route<Params>(async ({ session, request, params, t }) => {
  const [injury] = await db
    .select()
    .from(injuries)
    .where(
      and(eq(injuries.id, params.id), eq(injuries.userId, session.user.id)),
    )
    .limit(1);

  if (!injury) {
    return Response.json({ error: t('errors.injuryNotFound') }, { status: 404 });
  }

  const body = await parseBody(request, patchSchema);

  await db
    .update(injuries)
    .set({
      ...(body.severity ? { severity: body.severity } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.resolve
        ? { resolvedOn: localDate(session.user.timezone) }
        : body.resolvedOn !== undefined
          ? { resolvedOn: body.resolvedOn }
          : {}),
    })
    .where(eq(injuries.id, injury.id));

  return Response.json({ ok: true });
});

/**
 * Удаление — для ошибочной записи. Прошедшая травма закрывается, а не
 * удаляется: история важна, вернувшаяся боль в том же месте о многом говорит.
 */
export const DELETE = route<Params>(async ({ session, params, t }) => {
  const deleted = await db
    .delete(injuries)
    .where(
      and(eq(injuries.id, params.id), eq(injuries.userId, session.user.id)),
    )
    .returning({ id: injuries.id });

  if (deleted.length === 0) {
    return Response.json({ error: t('errors.injuryNotFound') }, { status: 404 });
  }

  return Response.json({ ok: true });
});
