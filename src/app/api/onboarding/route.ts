import { z } from 'zod';
import { eq } from 'drizzle-orm';

import { route, parseBody, dateSchema } from '@/lib/api';
import { db } from '@/db';
import { profiles, goals, weightLogs, users } from '@/db/schema';
import { localDate } from '@/db/queries';
import { calcAge, calcBodyType } from '@/lib/health/composition';
import { buildDailyPlan } from '@/lib/health/energy';

const schema = z.object({
  sex: z.enum(['male', 'female']),
  birthDate: dateSchema,
  heightCm: z.number().min(100, 'Рост меньше 100 см').max(250, 'Рост больше 250 см'),
  weightKg: z.number().min(30, 'Вес меньше 30 кг').max(400, 'Вес больше 400 кг'),
  activityLevel: z.enum(['sedentary', 'light', 'moderate', 'high', 'athlete']),

  // Каркас скелета — меряется один раз, дальше не меняется
  wristCm: z.number().min(10).max(30).nullable().optional(),
  ankleCm: z.number().min(12).max(40).nullable().optional(),

  goalType: z.enum(['lose', 'maintain', 'gain']),
  /** Желаемый темп, кг/неделю, всегда положительный */
  weeklyRateKg: z.number().min(0).max(2).optional(),
  targetWeightKg: z.number().min(30).max(400).nullable().optional(),

  /** IANA-зона из браузера: от неё зависит граница суток в дневнике */
  timezone: z.string().min(1).optional(),
});

/**
 * Онбординг одним запросом: профиль, первое взвешивание и цель с рассчитанной
 * нормой. В транзакции, потому что профиль без цели оставляет приложение
 * в наполовину настроенном состоянии — дашборд не знает, от чего считать
 * остаток калорий.
 */
export const POST = route(async ({ session, request }) => {
  const body = await parseBody(request, schema);
  const { user } = session;

  const age = calcAge(body.birthDate);
  if (age < 14 || age > 100) {
    return Response.json(
      { error: 'Проверьте дату рождения', fields: { birthDate: 'Возраст вне разумных границ' } },
      { status: 422 },
    );
  }

  // Процент жира на этом шаге неизвестен: обхваты шеи и талии снимаются
  // отдельно, в замерах. Поэтому обмен считается по Mifflin-St Jeor,
  // а на Katch-McArdle расчёт переключится сам после первых замеров.
  const plan = buildDailyPlan({
    sex: body.sex,
    age,
    heightCm: body.heightCm,
    weightKg: body.weightKg,
    activity: body.activityLevel,
    goalType: body.goalType,
    weeklyRateKg: body.weeklyRateKg,
  });

  const bodyType = calcBodyType(body.sex, body.wristCm, body.ankleCm);
  const timezone = body.timezone ?? user.timezone;
  const today = localDate(timezone);
  const now = new Date();

  await db.transaction(async (tx) => {
    if (body.timezone && body.timezone !== user.timezone) {
      await tx
        .update(users)
        .set({ timezone: body.timezone, updatedAt: now })
        .where(eq(users.id, user.id));
    }

    await tx
      .insert(profiles)
      .values({
        userId: user.id,
        sex: body.sex,
        birthDate: body.birthDate,
        heightCm: body.heightCm,
        activityLevel: body.activityLevel,
        wristCm: body.wristCm ?? null,
        ankleCm: body.ankleCm ?? null,
        bodyType: bodyType?.bodyType ?? null,
      })
      .onConflictDoUpdate({
        target: profiles.userId,
        set: {
          sex: body.sex,
          birthDate: body.birthDate,
          heightCm: body.heightCm,
          activityLevel: body.activityLevel,
          wristCm: body.wristCm ?? null,
          ankleCm: body.ankleCm ?? null,
          bodyType: bodyType?.bodyType ?? null,
          updatedAt: now,
        },
      });

    await tx
      .insert(weightLogs)
      .values({ userId: user.id, loggedOn: today, weightKg: body.weightKg })
      .onConflictDoUpdate({
        target: [weightLogs.userId, weightLogs.loggedOn],
        set: { weightKg: body.weightKg },
      });

    // Прежние цели снимаем с активных: одновременно активная цель может
    // быть только одна, иначе дашборду не от чего считать остаток
    await tx
      .update(goals)
      .set({ isActive: false })
      .where(eq(goals.userId, user.id));

    await tx.insert(goals).values({
      userId: user.id,
      type: body.goalType,
      targetWeightKg: body.targetWeightKg ?? null,
      weeklyRateKg:
        body.goalType === 'lose'
          ? -plan.effectiveWeeklyRateKg
          : body.goalType === 'gain'
            ? plan.effectiveWeeklyRateKg
            : 0,
      kcalTarget: plan.kcalTarget,
      proteinTargetG: plan.macros.proteinG,
      fatTargetG: plan.macros.fatG,
      carbTargetG: plan.macros.carbsG,
      isActive: true,
    });
  });

  return Response.json({
    ok: true,
    plan: {
      bmr: plan.bmr,
      bmrFormula: plan.bmrFormula,
      tdee: plan.tdee,
      kcalTarget: plan.kcalTarget,
      dailyDelta: plan.dailyDelta,
      effectiveWeeklyRateKg: plan.effectiveWeeklyRateKg,
      macros: plan.macros,
      // Что пришлось урезать и почему — показываем пользователю,
      // а не подменяем его цифру молча
      adjustments: plan.adjustments,
    },
    bodyType: bodyType?.bodyType ?? null,
    bodyTypeConsistent: bodyType?.isConsistent ?? null,
  });
});
