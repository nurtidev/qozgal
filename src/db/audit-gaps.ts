import { sql, and, gte, eq, isNull, isNotNull, desc } from 'drizzle-orm';

import { db } from '@/db';
import { foodEntries, foodItems } from '@/db/schema';

/**
 * Где приложение не смогло посчитать.
 *
 * Единственный отчёт, который показывает пробелы справочника по живым
 * данным. Позиция без нутриентов — это не сбой в логах, а человек, который
 * сфотографировал еду и получил «укажите калорийность вручную». Такие
 * случаи нигде не накапливаются сами: запись сохраняется, день считается
 * без неё, и приложение об этом молчит.
 *
 * Список неопознанных названий — и есть план пополнения справочника,
 * составленный не догадками, а тем, что люди действительно ели.
 *
 * Скрипт ничего не меняет. Запуск:
 *   npm run audit:gaps
 *   npm run audit:gaps -- --days=30
 *
 * Против прода — с его DATABASE_URL: локальная база отражает только сиды.
 */

const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

/** Доля позиций без нутриентов, выше которой это уже не отдельные случаи */
const ALARM_SHARE = 0.15;

function days(): number {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  const value = arg ? Number(arg.slice('--days='.length)) : 14;
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 14;
}

async function main() {
  const window = days();
  // make_interval, а не строка с приведением: параметр уходит числом,
  // и Postgres не приходится угадывать тип
  const since = sql`now() - make_interval(days => ${window})`;

  const [totals] = await db
    .select({
      entries: sql<number>`count(distinct ${foodEntries.id})`,
      items: sql<number>`count(${foodItems.id})`,
      missing: sql<number>`count(*) filter (where ${foodItems.productId} is null)`,
      photo: sql<number>`count(distinct ${foodEntries.id}) filter (where ${foodEntries.source} = 'photo')`,
      text: sql<number>`count(distinct ${foodEntries.id}) filter (where ${foodEntries.source} = 'text')`,
      repeat: sql<number>`count(distinct ${foodEntries.id}) filter (where ${foodEntries.source} = 'repeat')`,
    })
    .from(foodEntries)
    .innerJoin(foodItems, eq(foodItems.entryId, foodEntries.id))
    .where(gte(foodEntries.createdAt, since));

  const items = Number(totals?.items ?? 0);

  console.log(`\nЗа последние ${window} дней`);
  console.log('─'.repeat(66));

  if (items === 0) {
    console.log('Записей нет — либо база пустая, либо смотрим не туда.');
    console.log(
      `${DIM}Против прода запускать с его DATABASE_URL: локальная база отражает только сиды.${RESET}`,
    );
    return;
  }

  const missing = Number(totals?.missing ?? 0);
  const share = missing / items;
  const mark = share > ALARM_SHARE ? RED : share > 0 ? YELLOW : '';

  console.log(
    `записей ${totals?.entries} (фото ${totals?.photo}, текст ${totals?.text}, повтор ${totals?.repeat})`,
  );
  console.log(
    `позиций ${items}, из них без справочника ${mark}${missing} (${Math.round(share * 100)}%)${RESET}`,
  );

  /**
   * Названия, которые не нашлись. Считаем по тому, как их назвала модель:
   * это и есть строка, по которой шёл поиск, и по ней же видно, была ли
   * причина в справочнике или в самой формулировке («хлеб» без уточнения
   * отбор законно отвергает).
   */
  const gaps = await db
    .select({
      name: foodItems.nameRaw,
      times: sql<number>`count(*)`,
      grams: sql<number>`round(avg(${foodItems.grams})::numeric)`,
    })
    .from(foodItems)
    .innerJoin(foodEntries, eq(foodEntries.id, foodItems.entryId))
    .where(
      and(
        isNull(foodItems.productId),
        gte(foodEntries.createdAt, since),
      ),
    )
    .groupBy(foodItems.nameRaw)
    .orderBy(desc(sql`count(*)`))
    .limit(25);

  if (gaps.length > 0) {
    console.log(`\nЧего не хватает в справочнике${DIM} — по частоте${RESET}`);
    for (const gap of gaps) {
      console.log(
        `  ${String(gap.times).padStart(3)}×  ${gap.name}${DIM} (обычно ${gap.grams} г)${RESET}`,
      );
    }
  }

  /**
   * Позиции с карточкой, но с нулём калорий. Такого быть не должно: если
   * продукт найден, нутриенты пересчитываются от него. Ноль здесь означает
   * либо карточку с нулевой калорийностью, либо ошибку пересчёта — и второе
   * куда хуже, потому что молча уменьшает дневной итог.
   */
  const [zeroes] = await db
    .select({ count: sql<number>`count(*)` })
    .from(foodItems)
    .innerJoin(foodEntries, eq(foodEntries.id, foodItems.entryId))
    .where(
      and(
        isNotNull(foodItems.productId),
        eq(foodItems.kcal, 0),
        gte(foodEntries.createdAt, since),
      ),
    );

  if (Number(zeroes?.count ?? 0) > 0) {
    console.log(
      `\n${RED}Позиций с карточкой и нулём калорий: ${zeroes?.count}${RESET}`,
    );
    console.log(
      `${DIM}Так быть не должно — либо карточка нулевая, либо пересчёт сломан.${RESET}`,
    );
  }

  /**
   * Уверенность модели там, где справочник не помог. Если она высокая,
   * дело в справочнике; если низкая — модель сама не поняла, что на снимке,
   * и добавление карточки ничего не изменит.
   */
  const [confidence] = await db
    .select({
      // Приведение к numeric обязательно: round(double precision, int)
      // в Postgres не существует, а avg(real) даёт именно double precision
      missing: sql<number>`round((avg(${foodItems.aiConfidence}) filter (where ${foodItems.productId} is null))::numeric, 2)`,
      found: sql<number>`round((avg(${foodItems.aiConfidence}) filter (where ${foodItems.productId} is not null))::numeric, 2)`,
    })
    .from(foodItems)
    .innerJoin(foodEntries, eq(foodEntries.id, foodItems.entryId))
    .where(gte(foodEntries.createdAt, since));

  if (confidence?.missing !== null && confidence?.missing !== undefined) {
    console.log(
      `\nуверенность модели: ${confidence.missing} там, где карточки нет, ` +
        `${confidence.found ?? '—'} там, где нашлась`,
    );
    console.log(
      `${DIM}Высокая уверенность при отсутствии карточки — вопрос к справочнику.${RESET}`,
    );
    console.log(
      `${DIM}Низкая — модель сама не разобрала снимок, и карточка не поможет.${RESET}`,
    );
  }

  console.log(
    `\n${DIM}Оговорка: отсутствие записей о промахах не значит, что их не было.${RESET}`,
  );
  console.log(
    `${DIM}Упавший разбор записи не создаёт вовсе — такие случаи видны только в логах.${RESET}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
