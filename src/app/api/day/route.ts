import { and, eq, asc } from 'drizzle-orm';

import { route, dateSchema } from '@/lib/api';
import { db } from '@/db';
import { foodEntries } from '@/db/schema';
import { getDayTotals, getActiveGoal, localDate } from '@/db/queries';
import { toLocale } from '@/i18n/messages';

/**
 * Дневник за сутки: приёмы пищи с составом, итог и норма.
 *
 * Дата — локальная для пользователя, не UTC: иначе ужин в Алматы попадал бы
 * в один день, а завтрак — в предыдущий, и итог разъезжался бы с тем, что
 * человек реально съел.
 */
export const GET = route(async ({ session, request }) => {
  const { user } = session;
  const url = new URL(request.url);

  const raw = url.searchParams.get('date');
  const date = raw ? dateSchema.parse(raw) : localDate(user.timezone);

  const locale = toLocale(user.locale);

  const [entries, totals, goal] = await Promise.all([
    db.query.foodEntries.findMany({
      where: and(
        eq(foodEntries.userId, user.id),
        eq(foodEntries.consumedOn, date),
      ),
      with: {
        items: {
          orderBy: (items, { asc: ascend }) => [ascend(items.sortOrder)],
          // Карточка справочника нужна ради казахского названия: в снапшоте
          // лежит то, как позицию назвала модель, а она отвечает по-русски
          with: { product: true },
        },
      },
      orderBy: [asc(foodEntries.consumedAt)],
    }),
    getDayTotals(user.id, date),
    getActiveGoal(user.id),
  ]);

  return Response.json({
    date,
    // Черновики отдаём вместе с подтверждёнными, но помеченными: их видно
    // в списке как «ждёт подтверждения», и в дневной итог они не входят
    entries: entries.map((entry) => ({
      id: entry.id,
      mealType: entry.mealType,
      status: entry.status,
      source: entry.source,
      consumedAt: entry.consumedAt,
      photoRef: entry.photoUrl,
      items: entry.items.map((item) => ({
        id: item.id,
        name: localName(item.nameRaw, item.product?.nameKk ?? null, locale),
        grams: item.grams,
        kcal: item.kcal,
        proteinG: item.proteinG,
        fatG: item.fatG,
        carbsG: item.carbsG,
        confidence: item.aiConfidence,
        // Расхождение с исходной оценкой модели — материал для калибровки
        estimatedGrams: item.aiEstimatedGrams,
        hasNutrition: item.kcal > 0 || item.proteinG > 0,
      })),
      kcal: entry.items.reduce((sum, i) => sum + i.kcal, 0),
    })),
    totals,
    goal: goal
      ? {
          kcalTarget: goal.kcalTarget,
          proteinTargetG: goal.proteinTargetG,
          fatTargetG: goal.fatTargetG,
          carbTargetG: goal.carbTargetG,
          kcalLeft: goal.kcalTarget - totals.kcal,
        }
      : null,
  });
});

/**
 * Название позиции на языке пользователя.
 *
 * Снапшот записи хранит формулировку модели, а она отвечает по-русски.
 * У карточек местной кухни есть казахское имя — берём его, когда оно есть:
 * «Бесбармақ» в казахском интерфейсе уместнее «Бешбармака».
 */
function localName(
  raw: string,
  nameKk: string | null,
  locale: 'ru' | 'kk',
): string {
  return locale === 'kk' && nameKk ? nameKk : raw;
}
