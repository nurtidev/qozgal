import { z } from 'zod';
import { and, eq, gte, desc, inArray } from 'drizzle-orm';

import { route, parseBody, dateSchema } from '@/lib/api';
import { db } from '@/db';
import {
  workoutSessions,
  workoutSets,
  exercises,
  planDays,
  workoutPlans,
} from '@/db/schema';
import { localDate } from '@/db/queries';
import { toLocale } from '@/i18n/messages';
import { setVolume } from '@/lib/health/workout';

/**
 * Журнал тренировок.
 *
 * Тренировки намеренно не влияют на дневную норму калорий. Норма уже
 * учитывает их через коэффициент активности в TDEE, и повторный учёт
 * означал бы, что человек «зарабатывает» калории, которые ему уже начислены:
 * при трёх тренировках в неделю это лишние 300–500 ккал в день и дефицит,
 * которого на самом деле нет. Меняется режим — меняется образ жизни
 * в профиле, и норма пересчитывается там.
 *
 * Здесь считается другое: тоннаж и веса, по которым видно прогресс.
 */

const postSchema = z.object({
  performedOn: dateSchema.optional(),
  durationMin: z.number().int().min(1).max(600).optional(),
  note: z.string().max(500).optional(),
  /** День активной программы, если тренировка идёт по плану */
  planDayId: z.string().uuid().optional(),
});

export const POST = route(async ({ session, request, t }) => {
  const body = await parseBody(request, postSchema);
  const { user } = session;

  // День программы приходит из клиента, поэтому проверяется владение:
  // подставив чужой uuid, можно было бы привязать свою тренировку
  // к чужому плану и заодно узнать, что он существует
  let plan: { planId: string; planDayId: string } | null = null;
  if (body.planDayId) {
    const [day] = await db
      .select({ planId: planDays.planId, dayId: planDays.id })
      .from(planDays)
      .innerJoin(workoutPlans, eq(workoutPlans.id, planDays.planId))
      .where(
        and(eq(planDays.id, body.planDayId), eq(workoutPlans.userId, user.id)),
      )
      .limit(1);

    if (!day) {
      return Response.json(
        { error: t('errors.programNotFound') },
        { status: 404 },
      );
    }
    plan = { planId: day.planId, planDayId: day.dayId };
  }

  const [created] = await db
    .insert(workoutSessions)
    .values({
      userId: user.id,
      performedOn: body.performedOn ?? localDate(user.timezone),
      durationMin: body.durationMin ?? null,
      note: body.note ?? null,
      planId: plan?.planId ?? null,
      planDayId: plan?.planDayId ?? null,
    })
    .returning();

  return Response.json({ ok: true, id: created.id });
});

export const GET = route(async ({ session, request }) => {
  const url = new URL(request.url);
  const days = Math.min(Number(url.searchParams.get('days') ?? 60), 365);

  const from = new Date();
  from.setDate(from.getDate() - days);

  const sessions = await db
    .select()
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.userId, session.user.id),
        gte(workoutSessions.performedOn, from.toISOString().slice(0, 10)),
      ),
    )
    .orderBy(desc(workoutSessions.performedOn), desc(workoutSessions.createdAt))
    .limit(100);

  if (sessions.length === 0) {
    return Response.json({ workouts: [] });
  }

  const locale = toLocale(session.user.locale);

  // Подходы всех тренировок одним запросом: по отдельному на каждую
  // получилось бы сто обращений к базе на один экран
  const sets = await db
    .select({ set: workoutSets, exercise: exercises })
    .from(workoutSets)
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(
      inArray(
        workoutSets.sessionId,
        sessions.map((s) => s.id),
      ),
    )
    .orderBy(workoutSets.setIndex);

  return Response.json({
    workouts: sessions.map((s) => {
      const own = sets.filter((row) => row.set.sessionId === s.id);
      const names = [
        ...new Set(
          own.map(
            (row) =>
              (locale === 'kk' ? row.exercise.nameKk : row.exercise.nameRu) ??
              row.exercise.nameRu,
          ),
        ),
      ];

      return {
        id: s.id,
        performedOn: s.performedOn,
        durationMin: s.durationMin,
        note: s.note,
        exercises: names,
        setCount: own.length,
        // Тоннаж — сумма веса, поднятого за тренировку. Главная цифра
        // прогресса: она растёт и когда добавили вес, и когда добавили
        // повтор, тогда как рекорд в одном подходе может стоять месяцами
        volumeKg: Math.round(
          own.reduce((sum, row) => sum + setVolume(row.set.weightKg, row.set.reps), 0),
        ),
      };
    }),
  });
});
