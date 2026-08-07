import { eq, sql } from 'drizzle-orm';

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
} from '@/db/schema';
import { scaleToPortion } from '@/lib/nutrition/resolve';
import { calcBodyFatPct } from '@/lib/health/composition';
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

  console.log(`Пользователь: ${user.firstName} (tg ${DEFAULT_USER.id})`);
  console.log(`Запись:       ${entry.id}`);
  console.log(`Экран:        http://localhost:3000/entry/${entry.id}`);
  process.exit(0);
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
