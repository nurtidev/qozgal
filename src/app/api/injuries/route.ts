import { z } from 'zod';
import { and, eq, isNull, desc } from 'drizzle-orm';

import { route, parseBody, dateSchema } from '@/lib/api';
import { db } from '@/db';
import { injuries } from '@/db/schema';
import { localDate } from '@/db/queries';

/**
 * Травмы и ограничения.
 *
 * Приложение не ставит диагнозов и не разрешает нагрузку. Оно связывает
 * область жалобы с движениями, которые эту область нагружают, и предупреждает
 * при выборе упражнения. Решение остаётся за человеком и его врачом.
 */

const postSchema = z.object({
  area: z.enum([
    'lower_back',
    'neck',
    'shoulder',
    'elbow',
    'wrist',
    'hip',
    'knee',
    'ankle',
  ]),
  severity: z.enum(['watch', 'pain', 'medical']).optional(),
  startedOn: dateSchema.optional(),
  note: z.string().max(500).optional(),
});

export const POST = route(async ({ session, request }) => {
  const body = await parseBody(request, postSchema);
  const { user } = session;

  const [created] = await db
    .insert(injuries)
    .values({
      userId: user.id,
      area: body.area,
      severity: body.severity ?? 'pain',
      startedOn: body.startedOn ?? localDate(user.timezone),
      note: body.note ?? null,
    })
    .returning();

  return Response.json({ ok: true, id: created.id });
});

export const GET = route(async ({ session, request }) => {
  const url = new URL(request.url);
  const withClosed = url.searchParams.get('all') === '1';

  const rows = await db
    .select()
    .from(injuries)
    .where(
      withClosed
        ? eq(injuries.userId, session.user.id)
        : and(
            eq(injuries.userId, session.user.id),
            // Закрытая травма на подбор упражнений не влияет, но из истории
            // не исчезает: вернувшаяся боль в том же месте — важный факт
            isNull(injuries.resolvedOn),
          ),
    )
    .orderBy(desc(injuries.startedOn));

  return Response.json({
    injuries: rows.map((i) => ({
      id: i.id,
      area: i.area,
      severity: i.severity,
      startedOn: i.startedOn,
      resolvedOn: i.resolvedOn,
      note: i.note,
    })),
  });
});
