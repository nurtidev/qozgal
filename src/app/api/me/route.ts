import { route } from '@/lib/api';
import { getActiveGoal, getDayTotals, localDate } from '@/db/queries';
import { calcAge, calcBodyType } from '@/lib/health/composition';
import { calcBmr, calcTdee } from '@/lib/health/energy';
import { db } from '@/db';
import { weightLogs } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * Стартовые данные приложения: кто вошёл, пройден ли онбординг, норма и
 * сколько уже съедено сегодня. Одним запросом, чтобы дашборд не собирался
 * из четырёх последовательных обращений — на мобильной сети это заметно.
 */
export const GET = route(async ({ session }) => {
  const { user, profile } = session;
  const today = localDate(user.timezone);

  if (!profile) {
    return Response.json({
      user: publicUser(user),
      needsOnboarding: true,
      today,
    });
  }

  const [goal, totals, lastWeight] = await Promise.all([
    getActiveGoal(user.id),
    getDayTotals(user.id, today),
    db
      .select()
      .from(weightLogs)
      .where(eq(weightLogs.userId, user.id))
      .orderBy(desc(weightLogs.loggedOn))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const age = calcAge(profile.birthDate);
  const weightKg = lastWeight?.weightKg ?? null;

  // Обмен и расход показываем, только когда есть вес: без него формула
  // неприменима, а показать «0 ккал» хуже, чем не показать ничего.
  const energy = weightKg
    ? (() => {
        const bmr = calcBmr({
          sex: profile.sex,
          weightKg,
          heightCm: profile.heightCm,
          age,
        });
        return {
          bmr: bmr.kcal,
          formula: bmr.formula,
          tdee: calcTdee(bmr.kcal, profile.activityLevel),
        };
      })()
    : null;

  const bodyType = calcBodyType(profile.sex, profile.wristCm, profile.ankleCm);

  return Response.json({
    user: publicUser(user),
    needsOnboarding: false,
    today,
    profile: {
      sex: profile.sex,
      birthDate: profile.birthDate,
      age,
      heightCm: profile.heightCm,
      activityLevel: profile.activityLevel,
      wristCm: profile.wristCm,
      ankleCm: profile.ankleCm,
      bodyType: bodyType?.bodyType ?? null,
      // Расхождение запястья и щиколотки — повод показать оговорку,
      // а не молча выдать тип телосложения как факт
      bodyTypeConsistent: bodyType?.isConsistent ?? null,
    },
    weight: lastWeight
      ? { kg: lastWeight.weightKg, loggedOn: lastWeight.loggedOn }
      : null,
    energy,
    goal: goal
      ? {
          type: goal.type,
          kcalTarget: goal.kcalTarget,
          proteinTargetG: goal.proteinTargetG,
          fatTargetG: goal.fatTargetG,
          carbTargetG: goal.carbTargetG,
          targetWeightKg: goal.targetWeightKg,
          weeklyRateKg: goal.weeklyRateKg,
        }
      : null,
    todayTotals: totals,
  });
});

function publicUser(user: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  locale: string;
  timezone: string;
}) {
  // telegramId наружу не отдаём: клиенту он не нужен, а в логах и в трафике
  // это лишний идентификатор пользователя
  return {
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    photoUrl: user.photoUrl,
    locale: user.locale,
    timezone: user.timezone,
  };
}
