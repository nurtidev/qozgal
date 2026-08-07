import { and, eq, inArray } from 'drizzle-orm';

import { route } from '@/lib/api';
import { db } from '@/db';
import { workoutSessions, workoutSets } from '@/db/schema';

type Params = { id: string; setId: string };

/**
 * Удаляет подход.
 *
 * Ошибиться при записи легко — не тот вес, не то упражнение, — и правкой
 * это не лечится: подход проще перебить заново, чем редактировать
 * в четыре поля между подходами.
 */
export const DELETE = route<Params>(async ({ session, params, t }) => {
  // Проверка владения идёт через тренировку: у подхода своего пользователя
  // нет, и без этого join чужой подход удалялся бы по одному лишь UUID
  const owned = db
    .select({ id: workoutSessions.id })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.id, params.id),
        eq(workoutSessions.userId, session.user.id),
      ),
    );

  const deleted = await db
    .delete(workoutSets)
    .where(
      and(
        eq(workoutSets.id, params.setId),
        inArray(workoutSets.sessionId, owned),
      ),
    )
    .returning({ id: workoutSets.id });

  if (deleted.length === 0) {
    return Response.json({ error: t('errors.setNotFound') }, { status: 404 });
  }

  return Response.json({ ok: true });
});
