import { db } from './index';
import { products } from './schema';
import { KAZAKH_FOODS } from './seed-data/kazakh-foods';

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

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Наполнение справочника не удалось:', error);
    process.exit(1);
  });
