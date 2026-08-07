import { z } from 'zod';
import { and, eq, desc, ne } from 'drizzle-orm';

import { route, parseBody, dateSchema } from '@/lib/api';
import { db } from '@/db';
import { workoutSessions, workoutSets, exercises } from '@/db/schema';
import { toLocale } from '@/i18n/messages';
import { setVolume, estimateBurnKcal, bestSet } from '@/lib/health/workout';
import { latestWeight } from '@/db/queries';

type Params = { id: string };

/** Тренировка принадлежит вошедшему — иначе чужой журнал читался бы по UUID */
async function ownedSession(sessionId: string, userId: string) {
  const [found] = await db
    .select()
    .from(workoutSessions)
    .where(
      and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)),
    )
    .limit(1);
  return found ?? null;
}

export const GET = route<Params>(async ({ session, params, t }) => {
  const workout = await ownedSession(params.id, session.user.id);
  if (!workout) {
    return Response.json({ error: t('errors.workoutNotFound') }, { status: 404 });
  }

  const locale = toLocale(session.user.locale);

  const rows = await db
    .select({ set: workoutSets, exercise: exercises })
    .from(workoutSets)
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(eq(workoutSets.sessionId, workout.id))
    .orderBy(workoutSets.setIndex);

  /**
   * Прошлый результат по каждому упражнению — то, от чего человек
   * отталкивается сегодня. Без него журнал превращается в архив, который
   * никто не открывает: смысл записи в том, чтобы сделать больше прошлого.
   */
  const usedExercises = [...new Set(rows.map((r) => r.exercise.id))];
  const history: Record<string, { weightKg: number; reps: number } | null> = {};

  for (const exerciseId of usedExercises) {
    const previous = await db
      .select({ weightKg: workoutSets.weightKg, reps: workoutSets.reps })
      .from(workoutSets)
      .innerJoin(
        workoutSessions,
        eq(workoutSessions.id, workoutSets.sessionId),
      )
      .where(
        and(
          eq(workoutSets.exerciseId, exerciseId),
          eq(workoutSessions.userId, session.user.id),
          // Именно прошлая тренировка, а не текущая: сравнивать себя
          // с собой же сегодняшним бессмысленно
          ne(workoutSets.sessionId, workout.id),
        ),
      )
      .orderBy(desc(workoutSessions.performedOn))
      .limit(20);

    history[exerciseId] = bestSet(previous);
  }

  // MET у упражнений разный, берём средний по тренировке: точность здесь
  // всё равно на уровне порядка величины
  const mets = rows
    .map((r) => r.exercise.metValue)
    .filter((m): m is number => m !== null);
  const averageMet =
    mets.length > 0 ? mets.reduce((a, b) => a + b, 0) / mets.length : null;

  const weight = await latestWeight(session.user.id);

  return Response.json({
    id: workout.id,
    performedOn: workout.performedOn,
    durationMin: workout.durationMin,
    note: workout.note,
    volumeKg: Math.round(
      rows.reduce((sum, r) => sum + setVolume(r.set.weightKg, r.set.reps), 0),
    ),
    // Справочно и намеренно отдельным полем: к дневной норме не добавляется,
    // она уже учитывает тренировки через коэффициент активности
    estimatedBurnKcal: estimateBurnKcal(
      averageMet,
      weight?.weightKg ?? null,
      workout.durationMin,
    ),
    sets: rows.map((r) => ({
      id: r.set.id,
      exerciseId: r.exercise.id,
      exerciseName:
        (locale === 'kk' ? r.exercise.nameKk : r.exercise.nameRu) ??
        r.exercise.nameRu,
      muscleGroup: r.exercise.muscleGroup,
      setIndex: r.set.setIndex,
      weightKg: r.set.weightKg,
      reps: r.set.reps,
      rpe: r.set.rpe,
      previousBest: history[r.exercise.id] ?? null,
    })),
  });
});

const patchSchema = z.object({
  performedOn: dateSchema.optional(),
  durationMin: z.number().int().min(1).max(600).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});

export const PATCH = route<Params>(async ({ session, request, params, t }) => {
  const workout = await ownedSession(params.id, session.user.id);
  if (!workout) {
    return Response.json({ error: t('errors.workoutNotFound') }, { status: 404 });
  }

  const body = await parseBody(request, patchSchema);

  await db
    .update(workoutSessions)
    .set({
      ...(body.performedOn ? { performedOn: body.performedOn } : {}),
      ...(body.durationMin !== undefined ? { durationMin: body.durationMin } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    })
    .where(eq(workoutSessions.id, workout.id));

  return Response.json({ ok: true });
});

export const DELETE = route<Params>(async ({ session, params, t }) => {
  const deleted = await db
    .delete(workoutSessions)
    .where(
      and(
        eq(workoutSessions.id, params.id),
        eq(workoutSessions.userId, session.user.id),
      ),
    )
    .returning({ id: workoutSessions.id });

  if (deleted.length === 0) {
    return Response.json({ error: t('errors.workoutNotFound') }, { status: 404 });
  }

  return Response.json({ ok: true });
});
