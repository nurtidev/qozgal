import { eq, sql } from 'drizzle-orm';

import { db } from '@/db';
import {
  users,
  profiles,
  goals,
  weightLogs,
  foodEntries,
  foodItems,
  products,
} from '@/db/schema';
import { scaleToPortion } from '@/lib/nutrition/resolve';
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
      kcalTarget: 2209,
      proteinTargetG: 160,
      fatTargetG: 61,
      carbTargetG: 285,
      isActive: true,
    });
  }

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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
