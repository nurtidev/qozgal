import { z } from 'zod';
import { and, eq, desc, inArray, isNull, isNotNull } from 'drizzle-orm';

import { route, parseBody } from '@/lib/api';
import { db } from '@/db';
import {
  workoutPlans,
  planDays,
  planExercises,
  exercises,
  injuries,
  profiles,
  workoutSessions,
} from '@/db/schema';
import { localDate, getActiveGoal } from '@/db/queries';
import { toLocale } from '@/i18n/messages';
import { conflictsFor } from '@/lib/health/injury';
import {
  buildProgram,
  levelFromActivity,
  type Place,
  type SkippedSlot,
} from '@/lib/health/program';

/**
 * Программа тренировок.
 *
 * Собирается детерминированно — см. lib/health/program.ts. Модель здесь
 * не участвует вовсе, и это не осторожность: программа, которая меняется
 * от запуска к запуску, однажды предложит человеку с больной поясницей
 * становую тягу.
 *
 * Активная программа у человека одна. Пересборка не правит старую, а заводит
 * новую и гасит прежнюю: тренировки в журнале ссылаются на дни программы,
 * и переписать их задним числом значило бы соврать про то, что человек делал.
 */

/* ─────────────────────────── Чтение программы ──────────────────────── */

export const GET = route(async ({ session }) => {
  const [plan] = await db
    .select()
    .from(workoutPlans)
    .where(
      and(
        eq(workoutPlans.userId, session.user.id),
        eq(workoutPlans.isActive, true),
      ),
    )
    .orderBy(desc(workoutPlans.createdAt))
    .limit(1);

  if (!plan) return Response.json({ program: null });

  const locale = toLocale(session.user.locale);

  const days = await db
    .select()
    .from(planDays)
    .where(eq(planDays.planId, plan.id))
    .orderBy(planDays.dayIndex);

  const rows =
    days.length === 0
      ? []
      : await db
          .select({ planned: planExercises, exercise: exercises })
          .from(planExercises)
          .innerJoin(exercises, eq(exercises.id, planExercises.exerciseId))
          .where(
            inArray(
              planExercises.dayId,
              days.map((d) => d.id),
            ),
          )
          .orderBy(planExercises.sortOrder);

  /**
   * Травмы сверяются заново, а не берутся из сохранённого при сборке:
   * колено могло заболеть уже после того, как программа собрана, и молчать
   * об этом до пересборки нельзя.
   */
  const active = await db
    .select({ area: injuries.area, severity: injuries.severity })
    .from(injuries)
    .where(
      and(eq(injuries.userId, session.user.id), isNull(injuries.resolvedOn)),
    );

  return Response.json({
    program: {
      id: plan.id,
      daysPerWeek: plan.daysPerWeek,
      place: plan.place,
      goalType: plan.goalType,
      level: plan.level,
      startsOn: plan.startsOn,
      skipped: (plan.skipped ?? []) as SkippedSlot[],
      nextDayIndex: await nextDayIndex(plan.id, plan.daysPerWeek),
      days: days.map((day) => ({
        id: day.id,
        dayIndex: day.dayIndex,
        focus: day.focus,
        exercises: rows
          .filter((r) => r.planned.dayId === day.id)
          .map((r) => ({
            id: r.planned.id,
            exerciseId: r.exercise.id,
            name:
              (locale === 'kk' ? r.exercise.nameKk : r.exercise.nameRu) ??
              r.exercise.nameRu,
            equipment: r.exercise.equipment,
            muscleGroup: r.exercise.muscleGroup,
            sets: r.planned.sets,
            repMin: r.planned.repMin,
            repMax: r.planned.repMax,
            durationMin: r.planned.durationMin,
            restSec: r.planned.restSec,
            conflicts: conflictsFor(r.exercise.loadsAreas, active),
          })),
      })),
    },
  });
});

/**
 * Какой день делать следующим.
 *
 * Программа не привязана к календарю намеренно: «понедельник — грудь»
 * ломается на первой же командировке, и человек выпадает из программы
 * целиком. Считаем по журналу — следующий за последним выполненным.
 */
async function nextDayIndex(planId: string, daysPerWeek: number): Promise<number> {
  const days = await db
    .select({ id: planDays.id, dayIndex: planDays.dayIndex })
    .from(planDays)
    .where(eq(planDays.planId, planId));

  if (days.length === 0) return 1;

  const [last] = await db
    .select({ planDayId: workoutSessions.planDayId })
    .from(workoutSessions)
    .where(
      and(
        eq(workoutSessions.planId, planId),
        isNotNull(workoutSessions.planDayId),
      ),
    )
    .orderBy(desc(workoutSessions.performedOn), desc(workoutSessions.createdAt))
    .limit(1);

  const lastIndex = days.find((d) => d.id === last?.planDayId)?.dayIndex;
  if (!lastIndex) return 1;

  return (lastIndex % daysPerWeek) + 1;
}

/* ─────────────────────────── Сборка программы ──────────────────────── */

const postSchema = z.object({
  daysPerWeek: z.number().int().min(2).max(6),
  place: z.enum(['gym', 'home']),
});

export const POST = route(async ({ session, request, t }) => {
  const body = await parseBody(request, postSchema);
  const { user } = session;

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  if (!profile) {
    return Response.json({ error: t('errors.needProfile') }, { status: 422 });
  }

  const goal = await getActiveGoal(user.id);

  const active = await db
    .select({ area: injuries.area, severity: injuries.severity })
    .from(injuries)
    .where(and(eq(injuries.userId, user.id), isNull(injuries.resolvedOn)));

  const catalog = await db
    .select({
      id: exercises.id,
      nameRu: exercises.nameRu,
      pattern: exercises.pattern,
      equipment: exercises.equipment,
      loadsAreas: exercises.loadsAreas,
    })
    .from(exercises);

  const level = levelFromActivity(profile.activityLevel);
  const program = buildProgram({
    daysPerWeek: body.daysPerWeek,
    place: body.place as Place,
    // Цель на момент сборки: сменив её, человек пересоберёт программу —
    // подходы и повторы зависят от того, набирает он или снижает вес
    goal: goal?.type ?? 'maintain',
    level,
    exercises: catalog,
    injuries: active,
  });

  const planId = await db.transaction(async (tx) => {
    // Прежняя программа не удаляется: на её дни ссылаются записанные
    // тренировки, и журнал должен остаться правдой о прошлом
    await tx
      .update(workoutPlans)
      .set({ isActive: false })
      .where(
        and(eq(workoutPlans.userId, user.id), eq(workoutPlans.isActive, true)),
      );

    const [plan] = await tx
      .insert(workoutPlans)
      .values({
        userId: user.id,
        // Заголовок служебный: на экране подпись собирается из числа дней
        // и места на языке интерфейса, иначе казахское приложение показывало
        // бы русскую строку, записанную при сборке
        title: `Программа на ${program.daysPerWeek} дн/нед`,
        daysPerWeek: program.daysPerWeek,
        place: body.place,
        goalType: goal?.type ?? null,
        level,
        skipped: program.skipped,
        startsOn: localDate(user.timezone),
      })
      .returning({ id: workoutPlans.id });

    for (const day of program.days) {
      const [saved] = await tx
        .insert(planDays)
        .values({ planId: plan.id, dayIndex: day.dayIndex, focus: day.focus })
        .returning({ id: planDays.id });

      if (day.exercises.length === 0) continue;

      await tx.insert(planExercises).values(
        day.exercises.map((planned, index) => ({
          dayId: saved.id,
          exerciseId: planned.exerciseId,
          sortOrder: index,
          pattern: planned.pattern,
          sets: planned.sets,
          repMin: planned.repMin,
          repMax: planned.repMax,
          durationMin: planned.durationMin,
          restSec: planned.restSec,
        })),
      );
    }

    return plan.id;
  });

  return Response.json({ ok: true, id: planId, skipped: program.skipped });
});

/** Отказ от программы — план гасится, журнал тренировок остаётся как был */
export const DELETE = route(async ({ session, t }) => {
  const stopped = await db
    .update(workoutPlans)
    .set({ isActive: false })
    .where(
      and(
        eq(workoutPlans.userId, session.user.id),
        eq(workoutPlans.isActive, true),
      ),
    )
    .returning({ id: workoutPlans.id });

  if (stopped.length === 0) {
    return Response.json({ error: t('errors.programNotFound') }, { status: 404 });
  }

  return Response.json({ ok: true });
});
