import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { route, parseBody } from '@/lib/api';
import { db } from '@/db';
import { foodEntries, foodItems } from '@/db/schema';
import { localDate } from '@/db/queries';

const postSchema = z.object({
  /** Запись, которую повторяем */
  repeatOf: z.string().uuid(),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
});

/**
 * Повтор приёма пищи.
 *
 * Люди едят одно и то же: тот же завтрак пять дней в неделю. Каждый раз
 * фотографировать его и ждать разбора — работа, которой можно не быть, и
 * вызов модели, за который можно не платить. Позиции копируются снапшотом,
 * ровно теми числами, что были подтверждены в прошлый раз.
 *
 * Запись сразу подтверждённая: человек повторяет то, что уже проверил, и
 * просить подтвердить это заново — лишний шаг. Граммовку поправит на экране
 * записи, если сегодня съел больше.
 */
export const POST = route(async ({ session, request, t }) => {
  const body = await parseBody(request, postSchema);
  const { user } = session;

  const [origin] = await db
    .select()
    .from(foodEntries)
    .where(
      and(
        eq(foodEntries.id, body.repeatOf),
        // Повторить можно только свою запись: идентификатор приходит
        // от клиента и ничем больше не ограничен
        eq(foodEntries.userId, user.id),
      ),
    )
    .limit(1);

  if (!origin) {
    return Response.json({ error: t('errors.entryNotFound') }, { status: 404 });
  }

  const source = await db
    .select()
    .from(foodItems)
    .where(eq(foodItems.entryId, origin.id))
    .orderBy(foodItems.sortOrder);

  if (source.length === 0) {
    return Response.json({ error: t('errors.entryEmpty') }, { status: 422 });
  }

  const now = new Date();

  const entryId = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(foodEntries)
      .values({
        userId: user.id,
        consumedAt: now,
        consumedOn: localDate(user.timezone, now),
        mealType: body.mealType ?? origin.mealType,
        source: 'repeat',
        status: 'confirmed',
      })
      .returning({ id: foodEntries.id });

    await tx.insert(foodItems).values(
      source.map((item) => ({
        entryId: created.id,
        productId: item.productId,
        nameRaw: item.nameRaw,
        grams: item.grams,
        kcal: item.kcal,
        proteinG: item.proteinG,
        fatG: item.fatG,
        carbsG: item.carbsG,
        // Оценки модели не копируем: их не было — это копия подтверждённой
        // записи, и расхождение с оценкой модели считается по оригиналу
        aiConfidence: null,
        aiEstimatedGrams: null,
        sortOrder: item.sortOrder,
      })),
    );

    return created.id;
  });

  return Response.json({ ok: true, id: entryId });
});
