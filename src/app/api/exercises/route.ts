import { or, sql } from 'drizzle-orm';

import { route } from '@/lib/api';
import { db } from '@/db';
import { exercises } from '@/db/schema';
import { toLocale } from '@/i18n/messages';

/**
 * Справочник упражнений для выбора при записи подхода.
 *
 * Отдаётся целиком: тридцать восемь строк — это несколько килобайт, зато
 * список открывается мгновенно и работает в зале, где связь обычно плохая.
 * Поиск по подстроке нужен, когда человек уже знает, что ищет.
 */
export const GET = route(async ({ session, request }) => {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const locale = toLocale(session.user.locale);

  const rows = await db
    .select()
    .from(exercises)
    .where(
      query.length >= 2
        ? or(
            sql`lower(${exercises.nameRu}) like ${`%${query}%`}`,
            sql`lower(${exercises.nameKk}) like ${`%${query}%`}`,
          )
        : undefined,
    )
    .orderBy(exercises.muscleGroup, exercises.nameRu);

  return Response.json({
    exercises: rows.map((e) => ({
      id: e.id,
      // Казахское название есть не у всех: у новых упражнений его может
      // не быть вовсе, и русское тут честнее пустой строки
      name: (locale === 'kk' ? e.nameKk : e.nameRu) ?? e.nameRu,
      muscleGroup: e.muscleGroup,
      equipment: e.equipment,
    })),
  });
});
