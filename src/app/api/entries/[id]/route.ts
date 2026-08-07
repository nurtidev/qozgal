import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import { route, parseBody } from '@/lib/api';
import { db } from '@/db';
import { foodEntries, foodItems, products } from '@/db/schema';
import { scaleToPortion } from '@/lib/nutrition/resolve';
import { clearInlineKeyboard } from '@/lib/telegram/bot-api';

type Params = { id: string };

/**
 * Проверяет, что запись принадлежит вошедшему пользователю.
 *
 * Идентификатор приходит из URL, то есть полностью под контролем клиента.
 * Без этой проверки чужой дневник читался бы и правился по одному лишь
 * угаданному UUID — тот же класс дыры, что и доверие telegram_id из тела.
 */
async function ownedEntry(entryId: string, userId: string) {
  const [entry] = await db
    .select()
    .from(foodEntries)
    .where(and(eq(foodEntries.id, entryId), eq(foodEntries.userId, userId)))
    .limit(1);
  return entry ?? null;
}

/* ───────────────────────────── Чтение ──────────────────────────────── */

export const GET = route<Params>(async ({ session, params, t }) => {
  const entry = await ownedEntry(params.id, session.user.id);
  if (!entry) {
    return Response.json({ error: t('errors.entryNotFound') }, { status: 404 });
  }

  const items = await db
    .select()
    .from(foodItems)
    .where(eq(foodItems.entryId, entry.id))
    .orderBy(foodItems.sortOrder);

  return Response.json({
    id: entry.id,
    mealType: entry.mealType,
    status: entry.status,
    source: entry.source,
    consumedAt: entry.consumedAt,
    consumedOn: entry.consumedOn,
    items: items.map((i) => ({
      id: i.id,
      name: i.nameRaw,
      grams: i.grams,
      kcal: i.kcal,
      proteinG: i.proteinG,
      fatG: i.fatG,
      carbsG: i.carbsG,
      confidence: i.aiConfidence,
      estimatedGrams: i.aiEstimatedGrams,
      productId: i.productId,
    })),
  });
});

/* ───────────────────────────── Правка ──────────────────────────────── */

const patchSchema = z.object({
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
  status: z.enum(['confirmed', 'discarded']).optional(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        grams: z.number().min(0).max(5000),
      }),
    )
    .optional(),
  /** Удаление позиций, которых на тарелке не было */
  removeItemIds: z.array(z.string().uuid()).optional(),
});

/**
 * Правка разбора: граммовка, состав, приём пищи, подтверждение.
 *
 * Пересчёт нутриентов идёт от карточки продукта, а не масштабированием
 * сохранённых значений: при делении и повторном умножении накапливается
 * ошибка округления, а карточка — источник истины. Для позиций без
 * привязки к продукту масштабируем сохранённый снапшот, другого источника
 * у них нет.
 */
export const PATCH = route<Params>(async ({ session, request, params, t }) => {
  const entry = await ownedEntry(params.id, session.user.id);
  if (!entry) {
    return Response.json({ error: t('errors.entryNotFound') }, { status: 404 });
  }

  const body = await parseBody(request, patchSchema);

  await db.transaction(async (tx) => {
    if (body.removeItemIds?.length) {
      for (const itemId of body.removeItemIds) {
        await tx
          .delete(foodItems)
          .where(and(eq(foodItems.id, itemId), eq(foodItems.entryId, entry.id)));
      }
    }

    for (const change of body.items ?? []) {
      const [item] = await tx
        .select()
        .from(foodItems)
        .where(and(eq(foodItems.id, change.id), eq(foodItems.entryId, entry.id)))
        .limit(1);
      if (!item) continue;

      if (item.productId) {
        const [product] = await tx
          .select()
          .from(products)
          .where(eq(products.id, item.productId))
          .limit(1);

        if (product) {
          const n = scaleToPortion(product, change.grams);
          await tx
            .update(foodItems)
            .set({
              grams: change.grams,
              kcal: n.kcal,
              proteinG: n.proteinG,
              fatG: n.fatG,
              carbsG: n.carbsG,
            })
            .where(eq(foodItems.id, item.id));
          continue;
        }
      }

      // Продукта нет — пересчитываем от снапшота пропорцией
      const ratio = item.grams > 0 ? change.grams / item.grams : 0;
      await tx
        .update(foodItems)
        .set({
          grams: change.grams,
          kcal: Math.round(item.kcal * ratio),
          proteinG: Math.round(item.proteinG * ratio * 10) / 10,
          fatG: Math.round(item.fatG * ratio * 10) / 10,
          carbsG: Math.round(item.carbsG * ratio * 10) / 10,
        })
        .where(eq(foodItems.id, item.id));
    }

    if (body.mealType || body.status) {
      await tx
        .update(foodEntries)
        .set({
          ...(body.mealType ? { mealType: body.mealType } : {}),
          ...(body.status ? { status: body.status } : {}),
          updatedAt: new Date(),
        })
        .where(eq(foodEntries.id, entry.id));
    }
  });

  // Статус поменялся — под карточкой в чате больше нечего нажимать.
  // Кнопки гасим после транзакции: неудача в Telegram не должна
  // откатывать уже сохранённую правку.
  if (body.status && entry.botChatId && entry.botMessageId) {
    await clearInlineKeyboard(entry.botChatId, entry.botMessageId);
  }

  const items = await db
    .select()
    .from(foodItems)
    .where(eq(foodItems.entryId, entry.id))
    .orderBy(foodItems.sortOrder);

  return Response.json({
    ok: true,
    kcal: items.reduce((sum, i) => sum + i.kcal, 0),
    items: items.map((i) => ({
      id: i.id,
      name: i.nameRaw,
      grams: i.grams,
      kcal: i.kcal,
      proteinG: i.proteinG,
      fatG: i.fatG,
      carbsG: i.carbsG,
    })),
  });
});

/* ──────────────────────────── Удаление ─────────────────────────────── */

export const DELETE = route<Params>(async ({ session, params, t }) => {
  const deleted = await db
    .delete(foodEntries)
    .where(
      and(
        eq(foodEntries.id, params.id),
        eq(foodEntries.userId, session.user.id),
      ),
    )
    .returning({
      id: foodEntries.id,
      botChatId: foodEntries.botChatId,
      botMessageId: foodEntries.botMessageId,
    });

  if (deleted.length === 0) {
    return Response.json({ error: t('errors.entryNotFound') }, { status: 404 });
  }

  // Записи больше нет — кнопки под карточкой в чате ведут в никуда
  const [gone] = deleted;
  if (gone.botChatId && gone.botMessageId) {
    await clearInlineKeyboard(gone.botChatId, gone.botMessageId);
  }

  return Response.json({ ok: true });
});
