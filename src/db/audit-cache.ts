import { inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { products, foodItems } from '@/db/schema';
import { formOrPartWords } from '@/lib/nutrition/match';

/**
 * Разбор кеша внешних справочников.
 *
 * Кеш наполняется сам: карточка USDA, выбранная при разборе еды, остаётся
 * в справочнике и отвечает всем следующим пользователям. Пока отбор
 * кандидатов брал первый результат выдачи, туда попадало и лишнее —
 * на «apple» закрепилась `Rose-apples, raw` с 25 ккал/100 г вместо 52.
 *
 * Отбор теперь проверяет кандидатов и, что важнее, проверяет их же при
 * чтении из кеша — то есть неудачная карточка больше не отвечает на запрос.
 * Но она остаётся в справочнике и попадает в поиск по продуктам, где
 * человек выбирает руками, а там на неё нет никакой защиты.
 *
 * Скрипт ничего не удаляет сам. Он показывает карточки внешних источников
 * и помечает те, где в названии есть слово о форме («juice», «pie») или
 * части («fat», «skin») продукта. Пометка — не приговор: карточка сока
 * законна, если человек пил сок. Решение за человеком, поэтому удаление
 * идёт отдельным вызовом с точным списком:
 *
 *   npm run audit:cache
 *   npm run audit:cache -- --drop=<uuid>,<uuid>
 *
 * История записей при удалении не страдает: нутриенты в `food_items`
 * лежат снапшотом, а ссылка на карточку обнуляется (`on delete set null`).
 */

const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

async function main() {
  const dropArg = process.argv
    .find((arg) => arg.startsWith('--drop='))
    ?.slice('--drop='.length);

  const cached = await db
    .select({
      id: products.id,
      source: products.source,
      nameRu: products.nameRu,
      nameEn: products.nameEn,
      kcal: products.kcalPer100g,
      isVerified: products.isVerified,
      externalId: products.externalId,
      // Сколько записей дневника ссылается на карточку — цена ошибки
      // в прошлом; на будущее она влияет вся
      uses: sql<number>`(
        select count(*) from ${foodItems} where ${foodItems.productId} = ${products.id}
      )`,
    })
    .from(products)
    .where(inArray(products.source, ['usda', 'off']))
    .orderBy(products.nameEn);

  if (dropArg) {
    const ids = dropArg.split(',').map((id) => id.trim()).filter(Boolean);
    const targets = cached.filter((row) => ids.includes(row.id));
    const unknown = ids.filter((id) => !cached.some((row) => row.id === id));

    if (unknown.length > 0) {
      console.error(
        `Не найдены среди карточек внешних источников: ${unknown.join(', ')}`,
      );
      process.exit(1);
    }

    for (const row of targets) {
      console.log(
        `удаляю ${row.nameEn} (${Math.round(row.kcal)} ккал, ссылок: ${row.uses})`,
      );
    }

    await db.delete(products).where(inArray(products.id, ids));
    console.log(`\nУдалено карточек: ${targets.length}.`);
    console.log(
      `${DIM}Записи дневника сохранены: нутриенты в них лежат снапшотом.${RESET}`,
    );
    return;
  }

  if (cached.length === 0) {
    console.log('Кеш внешних справочников пуст — приложение ещё не разбирало еду.');
    return;
  }

  let flagged = 0;

  console.log(`Карточек из внешних справочников: ${cached.length}\n`);

  for (const row of cached) {
    const words = formOrPartWords(row.nameEn ?? row.nameRu);
    if (words.length > 0) flagged++;

    const mark = words.length > 0 ? `${YELLOW}⚠${RESET}` : ' ';
    const note = words.length > 0 ? ` ${YELLOW}← ${words.join(', ')}${RESET}` : '';

    console.log(
      `${mark} ${String(Math.round(row.kcal)).padStart(4)} ккал  ${row.source}  ` +
        `${row.nameEn ?? row.nameRu}${note}`,
    );
    console.log(
      `${DIM}     ${row.id}  ссылок: ${row.uses}  ${row.isVerified ? 'измерено' : 'оценка'}${RESET}`,
    );
  }

  console.log(`\nПомечено к просмотру: ${flagged} из ${cached.length}.`);
  console.log(
    `${DIM}Пометка значит «стоит взглянуть», а не «неверно»: карточка сока${RESET}`,
  );
  console.log(
    `${DIM}законна, если её выбрали под запрос о соке. Удаление — с --drop.${RESET}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
