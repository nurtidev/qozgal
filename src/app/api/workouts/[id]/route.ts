import { z } from 'zod';
import { and, eq, desc, ne, isNull } from 'drizzle-orm';

import { route, parseBody, dateSchema } from '@/lib/api';
import { db } from '@/db';
import {
  workoutSessions,
  workoutSets,
  exercises,
  planDays,
  planExercises,
  workoutPlans,
  injuries,
} from '@/db/schema';
import { toLocale } from '@/i18n/messages';
import { setVolume, estimateBurnKcal, bestSet } from '@/lib/health/workout';
import { conflictsFor } from '@/lib/health/injury';
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
    feeling: workout.feeling,
    painfulExerciseId: workout.painfulExerciseId,
    // План дня, если тренировка идёт по программе: в зале нужно видеть,
    // что осталось сделать, а не вспоминать это по журналу прошлой недели
    planDay: workout.planDayId
      ? await loadPlanDay(workout.planDayId, session.user.id, locale, rows)
      : null,
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

/**
 * План дня рядом с журналом.
 *
 * Отмеченным считается упражнение, по которому в этой тренировке уже есть
 * записанные подходы: галочка ставится фактом работы, а не отдельным тапом.
 * Лишний тап в зале — это тап, который не сделают.
 */
async function loadPlanDay(
  planDayId: string,
  userId: string,
  locale: 'ru' | 'kk',
  recorded: { set: { exerciseId: string } }[],
) {
  const [day] = await db
    .select({ day: planDays, plan: workoutPlans })
    .from(planDays)
    .innerJoin(workoutPlans, eq(workoutPlans.id, planDays.planId))
    .where(and(eq(planDays.id, planDayId), eq(workoutPlans.userId, userId)))
    .limit(1);

  if (!day) return null;

  const active = await db
    .select({ area: injuries.area, severity: injuries.severity })
    .from(injuries)
    .where(and(eq(injuries.userId, userId), isNull(injuries.resolvedOn)));

  const rows = await db
    .select({ planned: planExercises, exercise: exercises })
    .from(planExercises)
    .innerJoin(exercises, eq(exercises.id, planExercises.exerciseId))
    .where(eq(planExercises.dayId, day.day.id))
    .orderBy(planExercises.sortOrder);

  return {
    id: day.day.id,
    dayIndex: day.day.dayIndex,
    focus: day.day.focus,
    daysPerWeek: day.plan.daysPerWeek,
    exercises: rows.map((r) => ({
      exerciseId: r.exercise.id,
      name:
        (locale === 'kk' ? r.exercise.nameKk : r.exercise.nameRu) ??
        r.exercise.nameRu,
      muscleGroup: r.exercise.muscleGroup,
      sets: r.planned.sets,
      repMin: r.planned.repMin,
      repMax: r.planned.repMax,
      durationMin: r.planned.durationMin,
      restSec: r.planned.restSec,
      doneSets: recorded.filter((s) => s.set.exerciseId === r.exercise.id).length,
      conflicts: conflictsFor(r.exercise.loadsAreas, active),
    })),
  };
}

const patchSchema = z.object({
  performedOn: dateSchema.optional(),
  durationMin: z.number().int().min(1).max(600).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  /** Как прошла тренировка — основание для прогрессии нагрузки */
  feeling: z.enum(['easy', 'normal', 'hard', 'pain']).nullable().optional(),
  /** На каком движении было больно; имеет смысл только при feeling = pain */
  painfulExerciseId: z.string().uuid().nullable().optional(),
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
      ...(body.feeling !== undefined ? { feeling: body.feeling } : {}),
      // Упражнение с болью держим только при «было больно»: сменив ответ
      // на «нормально», человек снимает и жалобу, иначе она осталась бы
      // висеть и влиять на подбор
      ...(body.feeling !== undefined && body.feeling !== 'pain'
        ? { painfulExerciseId: null }
        : {}),
      ...(body.painfulExerciseId !== undefined
        ? { painfulExerciseId: body.painfulExerciseId }
        : {}),
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
