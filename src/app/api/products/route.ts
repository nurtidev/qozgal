import { or, sql } from 'drizzle-orm';

import { route } from '@/lib/api';
import { db } from '@/db';
import { products } from '@/db/schema';
import { toLocale } from '@/i18n/messages';

/**
 * Поиск по справочнику нутриентов.
 *
 * Нужен экрану правки: модель иногда не видит позицию — чай в пиале, кусок
 * хлеба сбоку тарелки. Раньше её было некуда дописать, и человек отправлял
 * блюдо боту заново, тратя ещё один вызов модели ради одной строки.
 *
 * Ищем только по тому, что уже есть в базе: своим карточкам местной кухни
 * и кешу USDA. Никакого обращения к модели — числа остаются
 * детерминированными, как и на всех остальных путях.
 */

/** Экранирование шаблона LIKE: «100%» в запросе не должно значить «что угодно» */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export const GET = route(async ({ session, request }) => {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();

  // По одной букве выдача бессмысленна: половина справочника подойдёт
  if (query.length < 2) {
    return Response.json({ products: [] });
  }

  const pattern = `%${escapeLike(query)}%`;
  const prefix = `${escapeLike(query)}%`;
  const locale = toLocale(session.user.locale);

  const rows = await db
    .select()
    .from(products)
    .where(
      or(
        sql`lower(${products.nameRu}) like ${pattern}`,
        sql`lower(${products.nameKk}) like ${pattern}`,
        sql`lower(${products.nameEn}) like ${pattern}`,
      ),
    )
    .orderBy(
      // Точное совпадение выше начала слова, начало слова выше вхождения
      // в середину: на «рис» сначала «Рис», потом «Рисовая каша», и только
      // потом «Плов с рисом»
      sql`case
            when lower(${products.nameRu}) = ${query}
              or lower(${products.nameKk}) = ${query} then 0
            when lower(${products.nameRu}) like ${prefix}
              or lower(${products.nameKk}) like ${prefix} then 1
            else 2 end`,
      sql`case ${products.source}
            when 'local' then 0
            when 'usda' then 1
            when 'off' then 2
            when 'user' then 3
            else 4 end`,
      sql`case when ${products.isVerified} then 0 else 1 end`,
      sql`length(${products.nameRu})`,
    )
    .limit(20);

  return Response.json({
    products: rows.map((p) => ({
      id: p.id,
      // Имя на языке пользователя; казахского названия может не быть —
      // у карточек из USDA его нет вовсе
      name: (locale === 'kk' ? p.nameKk : p.nameRu) ?? p.nameRu,
      kcalPer100g: p.kcalPer100g,
      proteinPer100g: p.proteinPer100g,
      fatPer100g: p.fatPer100g,
      carbsPer100g: p.carbsPer100g,
      defaultPortionG: p.defaultPortionG,
      portionLabel:
        (locale === 'kk' ? p.portionLabelKk : p.portionLabelRu) ?? null,
      // Карточки местной кухни — расчётные оценки, а не измерения.
      // Человек вправе знать, насколько цифре можно верить.
      isVerified: p.isVerified,
    })),
  });
});
