import { and, eq, isNull } from 'drizzle-orm';

import { route } from '@/lib/api';
import { db } from '@/db';
import {
  workoutPlans,
  planDays,
  planExercises,
  exercises,
  injuries,
} from '@/db/schema';
import { toLocale } from '@/i18n/messages';
import { conflictsFor } from '@/lib/health/injury';
import { nextAlternative, type MovementPattern, type Place } from '@/lib/health/program';

type Params = { id: string };

/**
 * Замена одного упражнения в программе на следующее того же паттерна.
 *
 * Правка идёт в саму программу, а не «на один раз»: человек заменил движение,
 * потому что оно ему не подходит, и через неделю оно не должно вернуться.
 * Журнал от этого не страдает — записанные подходы ссылаются на упражнение
 * сами, а не через план.
 *
 * Пересборка программы для этого не годится: она заводит новый план и меняет
 * все дни, то есть за одно неудобное движение человек платит потерей всей
 * привычной программы.
 *
 * Травмы читаются заново, а не берутся из сохранённого при сборке: колено
 * могло заболеть уже после, и замена обязана это учесть.
 */
export const POST = route<Params>(async ({ session, params, t }) => {
  const { user } = session;

  const [slot] = await db
    .select({
      planExerciseId: planExercises.id,
      exerciseId: planExercises.exerciseId,
      pattern: planExercises.pattern,
      dayId: planDays.id,
      place: workoutPlans.place,
    })
    .from(planExercises)
    .innerJoin(planDays, eq(planDays.id, planExercises.dayId))
    .innerJoin(workoutPlans, eq(workoutPlans.id, planDays.planId))
    .where(
      and(
        eq(planExercises.id, params.id),
        // Идентификатор приходит из URL и полностью под контролем клиента
        eq(workoutPlans.userId, user.id),
        eq(workoutPlans.isActive, true),
      ),
    )
    .limit(1);

  if (!slot) {
    return Response.json({ error: t('errors.programNotFound') }, { status: 404 });
  }

  /**
   * Кардио заменять нечем и незачем: слот один, а минуты не зависят
   * от снаряда. Отдельный ответ вместо общего «замены нет» — чтобы кнопка
   * у такого упражнения просто не показывалась.
   */
  if (!slot.pattern || slot.pattern === 'cardio') {
    return Response.json({ error: t('errors.noAlternative') }, { status: 422 });
  }

  const [catalog, active, siblings] = await Promise.all([
    db
      .select({
        id: exercises.id,
        nameRu: exercises.nameRu,
        pattern: exercises.pattern,
        equipment: exercises.equipment,
        loadsAreas: exercises.loadsAreas,
      })
      .from(exercises),
    db
      .select({ area: injuries.area, severity: injuries.severity })
      .from(injuries)
      .where(and(eq(injuries.userId, user.id), isNull(injuries.resolvedOn))),
    db
      .select({ exerciseId: planExercises.exerciseId })
      .from(planExercises)
      .where(eq(planExercises.dayId, slot.dayId)),
  ]);

  const alternative = nextAlternative({
    pattern: slot.pattern as MovementPattern,
    currentId: slot.exerciseId,
    exercises: catalog,
    place: slot.place as Place,
    injuries: active,
    takenIds: siblings.map((s) => s.exerciseId),
  });

  if (!alternative) {
    return Response.json({ error: t('errors.noAlternative') }, { status: 422 });
  }

  await db
    .update(planExercises)
    // Доза не пересчитывается: она зависит от паттерна, цели и уровня,
    // а паттерн у замены тот же
    .set({ exerciseId: alternative.exerciseId })
    .where(eq(planExercises.id, slot.planExerciseId));

  const locale = toLocale(user.locale);
  const [card] = catalog.filter((e) => e.id === alternative.exerciseId);
  const [full] = await db
    .select({ nameKk: exercises.nameKk, muscleGroup: exercises.muscleGroup })
    .from(exercises)
    .where(eq(exercises.id, alternative.exerciseId))
    .limit(1);

  return Response.json({
    ok: true,
    exercise: {
      exerciseId: alternative.exerciseId,
      name: (locale === 'kk' ? full?.nameKk : card.nameRu) ?? card.nameRu,
      equipment: card.equipment,
      muscleGroup: full?.muscleGroup ?? null,
      conflicts: conflictsFor(card.loadsAreas, active),
    },
  });
});
