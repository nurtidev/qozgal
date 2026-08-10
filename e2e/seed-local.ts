import { and, eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  users,
  profiles,
  goals,
  weightLogs,
  bodyMeasurements,
  foodEntries,
  foodItems,
  products,
  injuries,
  exercises,
  workoutPlans,
  planDays,
  planExercises,
} from '@/db/schema';
import { scaleToPortion } from '@/lib/nutrition/resolve';
import { calcBodyFatPct } from '@/lib/health/composition';
import { buildProgram } from '@/lib/health/program';
import { DEFAULT_USER } from './lib/telegram-stub';

/**
 * Данные для просмотра экранов Mini App в браузере.
 *
 * Заглушка Telegram входит под фиксированным пользователем (DEFAULT_USER),
 * а экранам нужно, чтобы у него были профиль, цель и хоть один разбор:
 * без записи /entry/[id] показать нечего, а дашборд уводит на онбординг.
 *
 * Работает только с локальной базой и падает на любой другой: в проде уже
 * лежат следы прошлых прогонов, и добавлять к ним новые незачем.
 *
 * Запуск: node --env-file=.env node_modules/.bin/tsx e2e/seed-local.ts
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(
      `Скрипт наполняет базу тестовыми данными и работает только локально, ` +
        `а DATABASE_URL смотрит на ${url.hostname}`,
    );
  }

  const [user] = await db
    .insert(users)
    .values({
      telegramId: BigInt(DEFAULT_USER.id),
      username: DEFAULT_USER.username ?? null,
      firstName: DEFAULT_USER.first_name ?? null,
      locale: 'ru',
      timezone: 'Asia/Almaty',
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: { lastSeenAt: new Date() },
    })
    .returning();

  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1);

  const today = new Date().toISOString().slice(0, 10);

  // Профиль и цель проверяются порознь: они пишутся разными запросами, и
  // прерванный на середине прогон оставил бы человека без нормы калорий —
  // дашборд показал бы «цель не задана», хотя профиль на месте
  if (!profile) {
    // Те же числа, что проверены юнит-тестами расчётного модуля:
    // мужчина 30 лет, 180 см, 80 кг, средняя активность, минус 0.5 кг/нед
    await db.insert(profiles).values({
      userId: user.id,
      sex: 'male',
      birthDate: '1996-05-14',
      heightCm: 180,
      activityLevel: 'moderate',
    });
    await db
      .insert(weightLogs)
      .values({ userId: user.id, weightKg: 80, loggedOn: today });
  }

  const [goal] = await db
    .select()
    .from(goals)
    .where(eq(goals.userId, user.id))
    .limit(1);

  if (!goal) {
    await db.insert(goals).values({
      userId: user.id,
      type: 'lose',
      weeklyRateKg: -0.5,
      targetWeightKg: 76,
      kcalTarget: 2209,
      proteinTargetG: 160,
      fatTargetG: 61,
      carbTargetG: 285,
      isActive: true,
    });
  } else if (goal.targetWeightKg == null) {
    // Цель по весу рисуется на графике пунктиром — без неё проверять нечего
    await db
      .update(goals)
      .set({ targetWeightKg: 76 })
      .where(eq(goals.id, goal.id));
  }

  await seedWeight(user.id);
  await seedMeasurements(user.id);
  await seedProgram(user.id);

  // Позиция со ссылкой на справочник — на ней видно, что правка граммовки
  // пересчитывается от карточки продукта, а не от снапшота
  const [product] = await db
    .select()
    .from(products)
    .where(sql`${products.nameRu} ilike '%куырдак%'`)
    .limit(1);

  // Снапшот считается от той же карточки, что и при настоящем разборе:
  // выдуманные числа разошлись бы с пересчётом на сервере, и расхождение
  // выглядело бы как ошибка экрана
  const meat = product ? scaleToPortion(product, 220) : null;

  // Записи за сегодня переписываются, а не добавляются: иначе каждый запуск
  // удлиняет дневник, дуга дня набирает всё новые сегменты, и скриншоты
  // перестают сравниваться между прогонами
  await db
    .delete(foodEntries)
    .where(and(eq(foodEntries.userId, user.id), eq(foodEntries.consumedOn, today)));

  const [entry] = await db
    .insert(foodEntries)
    .values({
      userId: user.id,
      consumedAt: new Date(),
      consumedOn: today,
      mealType: 'lunch',
      source: 'photo',
      status: 'pending',
      photoUrl: 'tg:seed-local',
    })
    .returning();

  await db.insert(foodItems).values([
    {
      entryId: entry.id,
      productId: product?.id ?? null,
      nameRaw: product?.nameRu ?? 'Куырдак',
      grams: 220,
      kcal: meat?.kcal ?? 528,
      proteinG: meat?.proteinG ?? 38.5,
      fatG: meat?.fatG ?? 39.6,
      carbsG: meat?.carbsG ?? 4.4,
      aiConfidence: 0.82,
      aiEstimatedGrams: 220,
      sortOrder: 0,
    },
    // Низкая уверенность модели — экран обязан об этом предупредить
    {
      entryId: entry.id,
      nameRaw: 'Лепёшка тандырная',
      grams: 90,
      kcal: 243,
      proteinG: 7.2,
      fatG: 2.7,
      carbsG: 48.6,
      aiConfidence: 0.45,
      aiEstimatedGrams: 90,
      sortOrder: 1,
    },
    // Ничего не нашлось в справочнике: нули здесь означают «нет данных»,
    // и показывать их как нулевую калорийность нельзя
    {
      entryId: entry.id,
      nameRaw: 'Соус к мясу',
      grams: 30,
      kcal: 0,
      proteinG: 0,
      fatG: 0,
      carbsG: 0,
      aiConfidence: 0.6,
      aiEstimatedGrams: 30,
      sortOrder: 2,
    },
  ]);

  await seedConfirmedMeals(user.id, today);

  console.log(`Пользователь: ${user.firstName} (tg ${DEFAULT_USER.id})`);
  console.log(`Запись:       ${entry.id}`);
  console.log(`Экран:        http://localhost:3000/entry/${entry.id}`);
  process.exit(0);
}

/**
 * Подтверждённые приёмы пищи за сегодня.
 *
 * Нужны ровно ради дуги дня: она разбита на сегменты по записям, и на
 * пустом дне от неё видно только дорожку. Три записи разной величины —
 * это и есть тот случай, ради которого дуга сделана сегментной: по форме
 * видно, что день собран из плотного завтрака и двух мелких добавок.
 */
async function seedConfirmedMeals(userId: string, today: string) {
  const meals = [
    {
      mealType: 'breakfast' as const,
      items: [
        { name: 'Овсяная каша на молоке', grams: 280, kcal: 296, p: 10.4, f: 8.1, c: 45.6 },
        { name: 'Яйцо варёное', grams: 110, kcal: 171, p: 13.9, f: 11.7, c: 1.2 },
      ],
    },
    {
      mealType: 'snack' as const,
      items: [
        { name: 'Яблоко', grams: 180, kcal: 94, p: 0.5, f: 0.3, c: 24.8 },
      ],
    },
    {
      mealType: 'dinner' as const,
      items: [
        { name: 'Куриная грудка', grams: 190, kcal: 314, p: 58.9, f: 6.9, c: 0 },
        { name: 'Рис отварной', grams: 210, kcal: 273, p: 5.7, f: 0.6, c: 59.9 },
        { name: 'Салат из огурцов и помидоров', grams: 150, kcal: 62, p: 1.4, f: 3.2, c: 6.6 },
      ],
    },
  ];

  for (const meal of meals) {
    const [entry] = await db
      .insert(foodEntries)
      .values({
        userId,
        consumedAt: new Date(),
        consumedOn: today,
        mealType: meal.mealType,
        source: 'text',
        status: 'confirmed',
        rawInput: meal.items.map((i) => i.name.toLowerCase()).join(', '),
      })
      .returning();

    await db.insert(foodItems).values(
      meal.items.map((item, index) => ({
        entryId: entry.id,
        nameRaw: item.name,
        grams: item.grams,
        kcal: item.kcal,
        proteinG: item.p,
        fatG: item.f,
        carbsG: item.c,
        aiConfidence: 0.9,
        aiEstimatedGrams: item.grams,
        sortOrder: index,
      })),
    );
  }
}

/** Дата N дней назад в формате ГГГГ-ММ-ДД */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Два месяца взвешиваний с провалами в расписании.
 *
 * Колебание задаётся синусом, а не случайным числом: повторный запуск
 * должен давать тот же график, иначе скриншоты не сравнить между собой.
 * Пропуски нужны намеренно — по ним видно, что ось X идёт по датам, а не
 * по номеру записи.
 */
async function seedWeight(userId: string) {
  for (let ago = 60; ago >= 0; ago--) {
    if (ago % 3 === 1) continue; // пропущенные дни
    if (ago > 20 && ago < 30) continue; // отпуск без весов

    const weightKg =
      Math.round((82 - 0.055 * (60 - ago) + 0.5 * Math.sin(ago * 1.7)) * 10) / 10;

    await db
      .insert(weightLogs)
      .values({ userId, loggedOn: daysAgo(ago), weightKg })
      .onConflictDoUpdate({
        target: [weightLogs.userId, weightLogs.loggedOn],
        set: { weightKg },
      });
  }
}

/** Три замера с уходящей талией — на них видно динамику процента жира */
async function seedMeasurements(userId: string) {
  const rows = [
    { ago: 42, neckCm: 39, waistCm: 92, chestCm: 104, bicepsCm: 35 },
    { ago: 21, neckCm: 38.5, waistCm: 89, chestCm: 103, bicepsCm: 35 },
    { ago: 3, neckCm: 38, waistCm: 86.5, chestCm: 102, bicepsCm: 35.5 },
  ];

  for (const row of rows) {
    const bodyFatPct = calcBodyFatPct({
      sex: 'male',
      heightCm: 180,
      neckCm: row.neckCm,
      waistCm: row.waistCm,
    });

    await db
      .insert(bodyMeasurements)
      .values({
        userId,
        measuredOn: daysAgo(row.ago),
        neckCm: row.neckCm,
        waistCm: row.waistCm,
        chestCm: row.chestCm,
        bicepsCm: row.bicepsCm,
        bodyFatPct,
      })
      .onConflictDoUpdate({
        target: [bodyMeasurements.userId, bodyMeasurements.measuredOn],
        set: { neckCm: row.neckCm, waistCm: row.waistCm, bodyFatPct },
      });
  }
}

/**
 * Программа тренировок и одно ограничение.
 *
 * Ограничение здесь не для красоты: без активной травмы экран программы
 * показывает благополучный случай, а проверять надо как раз обратный —
 * помеченные упражнения и слоты, для которых замены не нашлось. Колено
 * «беспокоит» даёт ровно это: в ногах чистой замены нет, и движение
 * остаётся с пометкой.
 *
 * Программа собирается той же функцией, что и в API, а не переписанной
 * копией: иначе на скриншотах проверялась бы вторая реализация, которой
 * в приложении нет.
 */
async function seedProgram(userId: string) {
  // Состояние задаётся, а не дописывается: травма, оставшаяся от прошлой
  // ручной проверки, меняет подбор — и скриншот показывает уже не то,
  // что задумано, а историю локальной базы
  await db.delete(injuries).where(eq(injuries.userId, userId));
  await db.insert(injuries).values({
    userId,
    area: 'knee',
    severity: 'watch',
    startedOn: daysAgo(30),
  });

  await db.delete(workoutPlans).where(eq(workoutPlans.userId, userId));

  const active = await db
    .select({ area: injuries.area, severity: injuries.severity })
    .from(injuries)
    .where(eq(injuries.userId, userId));

  const catalog = await db
    .select({
      id: exercises.id,
      nameRu: exercises.nameRu,
      pattern: exercises.pattern,
      equipment: exercises.equipment,
      loadsAreas: exercises.loadsAreas,
    })
    .from(exercises);

  const program = buildProgram({
    daysPerWeek: 4,
    place: 'gym',
    goal: 'lose',
    level: 'regular',
    exercises: catalog,
    injuries: active,
  });

  const [created] = await db
    .insert(workoutPlans)
    .values({
      userId,
      title: `Программа на ${program.daysPerWeek} дн/нед`,
      daysPerWeek: program.daysPerWeek,
      place: 'gym',
      goalType: 'lose',
      level: 'regular',
      skipped: program.skipped,
      startsOn: daysAgo(7),
    })
    .returning({ id: workoutPlans.id });

  for (const day of program.days) {
    const [saved] = await db
      .insert(planDays)
      .values({ planId: created.id, dayIndex: day.dayIndex, focus: day.focus })
      .returning({ id: planDays.id });

    if (day.exercises.length === 0) continue;

    await db.insert(planExercises).values(
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
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
