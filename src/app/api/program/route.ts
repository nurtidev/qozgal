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
  workoutSets,
} from '@/db/schema';
import { localDate, getActiveGoal } from '@/db/queries';
import { toLocale } from '@/i18n/messages';
import { conflictsFor } from '@/lib/health/injury';
import {
  buildProgram,
  levelFromActivity,
  type MovementPattern,
  type SkippedSlot,
} from '@/lib/health/program';
import { advise, type Advice, type SessionLog } from '@/lib/health/progression';

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

  const advices = await progressionAdvice(session.user.id, rows);

  return Response.json({
    program: {
      id: plan.id,
      daysPerWeek: plan.daysPerWeek,
      place: plan.place,
      equipment: plan.equipment ?? [],
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
            advice: advices.get(r.planned.id) ?? null,
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

/**
 * Совет по весу для каждого упражнения программы.
 *
 * Историю берём одним запросом на всю программу, а не по упражнению:
 * в шестидневном плане это тридцать шесть запросов на открытие экрана.
 *
 * Правила считает `lib/health/progression`. Здесь только сбор данных —
 * и это разделение не косметика: правила проверяются юнит-тестами, а
 * запросы к базе в тестах не участвуют.
 */
async function progressionAdvice(
  userId: string,
  rows: { planned: typeof planExercises.$inferSelect }[],
): Promise<Map<string, Advice>> {
  const advices = new Map<string, Advice>();
  if (rows.length === 0) return advices;

  const exerciseIds = [...new Set(rows.map((r) => r.planned.exerciseId))];

  /**
   * Две последние тренировки на упражнение — столько же, сколько требуют
   * правила. Берём с запасом по сессиям и режем в памяти: LIMIT на группу
   * в SQL пришлось бы писать оконной функцией, а выигрыш здесь нулевой.
   */
  const logs = await db
    .select({
      exerciseId: workoutSets.exerciseId,
      sessionId: workoutSets.sessionId,
      performedOn: workoutSessions.performedOn,
      feeling: workoutSessions.feeling,
      painfulExerciseId: workoutSessions.painfulExerciseId,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      rpe: workoutSets.rpe,
    })
    .from(workoutSets)
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSets.sessionId))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        inArray(workoutSets.exerciseId, exerciseIds),
      ),
    )
    .orderBy(desc(workoutSessions.performedOn), desc(workoutSessions.createdAt));

  /** Подходы, сгруппированные по упражнению и тренировке */
  const byExercise = new Map<string, Map<string, SessionLog>>();

  for (const row of logs) {
    const sessions = byExercise.get(row.exerciseId) ?? new Map<string, SessionLog>();
    const existing = sessions.get(row.sessionId) ?? {
      performedOn: row.performedOn,
      feeling: row.feeling,
      painful: row.painfulExerciseId === row.exerciseId,
      sets: [],
    };

    existing.sets.push({
      weightKg: row.weightKg,
      reps: row.reps,
      rpe: row.rpe,
    });
    sessions.set(row.sessionId, existing);
    byExercise.set(row.exerciseId, sessions);
  }

  for (const { planned } of rows) {
    const history = [...(byExercise.get(planned.exerciseId)?.values() ?? [])];

    // Кардио считается минутами: прибавлять к нему вес нечего
    if (!planned.pattern || planned.pattern === 'cardio' || planned.repMax === null) {
      continue;
    }

    advices.set(
      planned.id,
      advise({
        pattern: planned.pattern as MovementPattern,
        repMin: planned.repMin ?? 0,
        repMax: planned.repMax,
        plannedSets: planned.sets,
        history,
      }),
    );
  }

  return advices;
}

/* ─────────────────────────── Сборка программы ──────────────────────── */

const EQUIPMENT = [
  'штанга',
  'тренажёр',
  'гантели',
  'брусья',
  'турник',
  'скакалка',
  'без инвентаря',
] as const;

const postSchema = z.object({
  daysPerWeek: z.number().int().min(2).max(6),
  /**
   * Что есть из инвентаря. Пустой список допустим и означает «только
   * собственный вес»: подбор всё равно добавляет его сам, и отказывать
   * человеку, у которого нет ничего, незачем.
   */
  equipment: z.array(z.enum(EQUIPMENT)).max(EQUIPMENT.length),
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
    equipment: body.equipment,
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
        // place пишется для совместимости с планами, собранными раньше:
        // отличить «зал» от «дома» можно по наличию штанги или тренажёров
        place: body.equipment.some((e) => e === 'штанга' || e === 'тренажёр')
          ? 'gym'
          : 'home',
        equipment: body.equipment,
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
