import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';

import { route, parseBody } from '@/lib/api';
import { db } from '@/db';
import { foodEntries, foodItems, products } from '@/db/schema';
import { scaleToPortion } from '@/lib/nutrition/resolve';
import { toLocale } from '@/i18n/messages';

type Params = { id: string };

const postSchema = z.object({
  productId: z.string().uuid(),
  grams: z.number().min(1).max(5000),
});

/**
 * Дописывает позицию, которую модель не увидела.
 *
 * Продукт берётся из справочника, а не из текста: нутриенты считаются от
 * карточки тем же способом, что и при разборе фотографии. Свободный ввод
 * названия пришлось бы отправлять в модель, и одна забытая пиала чая стоила
 * бы столько же, сколько разбор всей тарелки.
 */
export const POST = route<Params>(async ({ session, request, params, t }) => {
  const [entry] = await db
    .select()
    .from(foodEntries)
    .where(
      and(
        eq(foodEntries.id, params.id),
        // Та же проверка владения, что и на чтении записи: идентификатор
        // приходит из URL и полностью под контролем клиента
        eq(foodEntries.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!entry) {
    return Response.json({ error: t('errors.entryNotFound') }, { status: 404 });
  }

  const body = await parseBody(request, postSchema);

  const [product] = await db
    .select()
    .from(products)
    .where(eq(products.id, body.productId))
    .limit(1);

  if (!product) {
    return Response.json({ error: t('errors.productNotFound') }, { status: 404 });
  }

  const nutrition = scaleToPortion(product, body.grams);

  // Имя сохраняем в том виде, в каком человек его выбрал: у позиций от
  // модели nameRaw — это её формулировка, здесь — то, что было на экране.
  // Иначе казахоязычный пользователь добавляет «Бесбармақ», а в дневнике
  // назавтра видит «Бешбармак».
  const locale = toLocale(session.user.locale);
  const name = (locale === 'kk' ? product.nameKk : product.nameRu) ?? product.nameRu;

  // Новая позиция встаёт в конец списка, а не в начало: человек видит её
  // там, где ожидает — под тем, что уже разобрано
  const [{ next }] = await db
    .select({
      next: sql<number>`coalesce(max(${foodItems.sortOrder}), -1) + 1`,
    })
    .from(foodItems)
    .where(eq(foodItems.entryId, entry.id));

  const [item] = await db
    .insert(foodItems)
    .values({
      entryId: entry.id,
      productId: product.id,
      nameRaw: name,
      grams: body.grams,
      kcal: nutrition.kcal,
      proteinG: nutrition.proteinG,
      fatG: nutrition.fatG,
      carbsG: nutrition.carbsG,
      // Модель эту позицию не предлагала — ни уверенности, ни своей оценки
      // веса у неё нет, и выдумывать их нельзя: расхождение с оценкой модели
      // потом используется для калибровки
      aiConfidence: null,
      aiEstimatedGrams: null,
      sortOrder: Number(next),
    })
    .returning();

  await db
    .update(foodEntries)
    .set({ updatedAt: new Date() })
    .where(eq(foodEntries.id, entry.id));

  return Response.json({
    ok: true,
    item: {
      id: item.id,
      name: item.nameRaw,
      grams: item.grams,
      kcal: item.kcal,
      proteinG: item.proteinG,
      fatG: item.fatG,
      carbsG: item.carbsG,
      confidence: item.aiConfidence,
      estimatedGrams: item.aiEstimatedGrams,
      productId: item.productId,
    },
  });
});
