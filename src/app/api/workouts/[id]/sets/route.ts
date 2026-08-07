import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';

import { route, parseBody } from '@/lib/api';
import { db } from '@/db';
import { workoutSessions, workoutSets, exercises } from '@/db/schema';

type Params = { id: string };

const postSchema = z.object({
  exerciseId: z.string().uuid(),
  /** Вес снаряда; у подтягиваний и планки его нет */
  weightKg: z.number().min(0).max(500).nullable().optional(),
  reps: z.number().int().min(1).max(200).nullable().optional(),
  /** Субъективная тяжесть 1..10 — по ней строится прогрессия нагрузки */
  rpe: z.number().min(1).max(10).nullable().optional(),
});

/**
 * Добавляет подход в тренировку.
 *
 * По одному подходу за запрос, а не всё упражнение целиком: в зале запись
 * идёт между подходами, и форма, которую надо заполнить заранее до конца,
 * не соответствует тому, как это происходит на самом деле.
 */
export const POST = route<Params>(async ({ session, request, params, t }) => {
  const [workout] = await db
    .select()
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.id, params.id),
        eq(workoutSessions.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!workout) {
    return Response.json({ error: t('errors.workoutNotFound') }, { status: 404 });
  }

  const body = await parseBody(request, postSchema);

  const [exercise] = await db
    .select()
    .from(exercises)
    .where(eq(exercises.id, body.exerciseId))
    .limit(1);

  if (!exercise) {
    return Response.json({ error: t('errors.exerciseNotFound') }, { status: 404 });
  }

  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${workoutSets.setIndex}), 0) + 1`,
    })
    .from(workoutSets)
    .where(eq(workoutSets.sessionId, workout.id));

  const [created] = await db
    .insert(workoutSets)
    .values({
      sessionId: workout.id,
      exerciseId: exercise.id,
      setIndex: Number(next),
      weightKg: body.weightKg ?? null,
      reps: body.reps ?? null,
      rpe: body.rpe ?? null,
    })
    .returning();

  return Response.json({ ok: true, id: created.id, setIndex: created.setIndex });
});
