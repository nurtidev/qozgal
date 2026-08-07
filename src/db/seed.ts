import { eq } from 'drizzle-orm';
import { db } from './index';
import { products, exercises } from './schema';
import { KAZAKH_FOODS } from './seed-data/kazakh-foods';
import { EXERCISES } from './seed-data/exercises';

/**
 * Наполняет справочник локальными блюдами.
 *
 * Скрипт идемпотентен: повторный запуск обновит существующие карточки
 * по паре (source, external_id), а не создаст дубли. Значит, поправив
 * цифры в seed-data, достаточно запустить `npm run db:seed` ещё раз.
 */
async function seed() {
  console.log(`Загружаю ${KAZAKH_FOODS.length} карточек локальной кухни…`);

  const saved = await db
    .insert(products)
    .values(KAZAKH_FOODS)
    .onConflictDoUpdate({
      target: [products.source, products.externalId],
      set: {
        nameRu: products.nameRu,
        nameKk: products.nameKk,
        nameEn: products.nameEn,
        kcalPer100g: products.kcalPer100g,
        proteinPer100g: products.proteinPer100g,
        fatPer100g: products.fatPer100g,
        carbsPer100g: products.carbsPer100g,
        defaultPortionG: products.defaultPortionG,
        portionLabelRu: products.portionLabelRu,
        portionLabelKk: products.portionLabelKk,
        isVerified: products.isVerified,
      },
    })
    .returning({ id: products.id });

  console.log(`Готово: ${saved.length} карточек в справочнике.`);

  await seedExercises();

  const unverified = KAZAKH_FOODS.filter((f) => !f.isVerified).length;
  if (unverified > 0) {
    console.warn(
      `\n⚠️  ${unverified} карточек помечены как непроверенные.\n` +
        '   Значения рассчитаны по типовым рецептурам и могут расходиться\n' +
        '   с реальностью на 15–25%. Перед продакшеном сверьте их с таблицами\n' +
        '   химического состава блюд — см. комментарий в seed-data/kazakh-foods.ts',
    );
  }
}

/**
 * Справочник упражнений.
 *
 * Дописываем недостающие, а не перезаписываем всё: у таблицы нет уникального
 * ключа по названию, а на упражнения ссылаются подходы в чужих тренировках —
 * пересоздание оборвало бы эти ссылки.
 */
async function seedExercises() {
  const existing = await db.select({ nameRu: exercises.nameRu }).from(exercises);
  const known = new Set(existing.map((e) => e.nameRu));
  const missing = EXERCISES.filter((e) => !known.has(e.nameRu));

  if (missing.length > 0) {
    await db.insert(exercises).values(missing);
  }

  // Разметка нагружаемых областей обновляется у всех, а не только у новых:
  // это справочные данные, и правка в файле должна доезжать до базы. Правка
  // тут напрямую влияет на предупреждения о травмах — устаревшая разметка
  // означала бы, что человеку не сказали про опасное движение.
  for (const exercise of EXERCISES) {
    await db
      .update(exercises)
      .set({ loadsAreas: exercise.loadsAreas ?? [], metValue: exercise.metValue })
      .where(eq(exercises.nameRu, exercise.nameRu));
  }

  console.log(
    `Упражнения: добавлено ${missing.length}, всего ${known.size + missing.length}, разметка обновлена.`,
  );
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Наполнение справочника не удалось:', error);
    process.exit(1);
  });
