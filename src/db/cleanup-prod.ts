import { and, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db';
import { users, foodEntries, foodItems } from '@/db/schema';

/**
 * Чистка следов разработки перед пилотом.
 *
 * Удаляется ровно то, что перечислено в CLAUDE.md как тестовое: дневник
 * владельца за 07.08.2026 и пользователи, заведённые прогонами API. Всё
 * остальное — живые записи, и решать, что из них мусор, не дело скрипта:
 * в базе уже есть второй человек со своим дневником.
 *
 * Без флага только показывает, что будет удалено:
 *   npm run db:cleanup
 *   npm run db:cleanup -- --yes            и записи, и пользователей
 *   npm run db:cleanup -- --yes --users    только пользователей от прогонов
 *   npm run db:cleanup -- --yes --entries  только записи за тестовую дату
 *
 * Разделение появилось не для гибкости: записи за 07.08.2026 при ближайшем
 * рассмотрении оказались двумя одинаковыми ужинами на 1149 и 1191 ккал —
 * то есть настоящей едой, задублированной при проверке. Пользователи
 * от прогонов — мусор без сомнений, а такие записи стоит показать хозяину
 * дневника, прежде чем удалять.
 *
 * Тестовые пользователи вернутся при следующем прогоне e2e против прода —
 * это нормально, они создаются сами. Смысл чистки не в том, чтобы их
 * не стало никогда, а в том, чтобы пилот начался с чистой статистики.
 */

const OWNER_TG = BigInt(1811775131);
const TEST_DATE = '2026-08-07';
const TEST_USERS = [990000101, 990000102, 990000103, 999000001].map(BigInt);

const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

async function main() {
  const confirmed = process.argv.includes('--yes');
  const onlyUsers = process.argv.includes('--users');
  const onlyEntries = process.argv.includes('--entries');
  // Ни один флаг не указан — работаем с тем и другим, как раньше
  const withEntries = !onlyUsers || onlyEntries;
  const withUsers = !onlyEntries || onlyUsers;

  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, OWNER_TG))
    .limit(1);

  const entries = owner
    ? await db
        .select({ id: foodEntries.id, meal: foodEntries.mealType })
        .from(foodEntries)
        .where(
          and(
            eq(foodEntries.userId, owner.id),
            eq(foodEntries.consumedOn, TEST_DATE),
          ),
        )
    : [];

  /**
   * Калорийность считается отдельным запросом с группировкой, а не
   * коррелированным подзапросом внутри select: тот молча возвращал ноль,
   * и записи с настоящим ужином на 1149 ккал выглядели пустыми. Скрипт,
   * который перед необратимым удалением показывает не те числа, опаснее
   * отсутствия скрипта: человек согласится, не задумываясь.
   */
  const sums = new Map<string, { kcal: number; items: number }>();

  if (entries.length > 0) {
    const rows = await db
      .select({
        entryId: foodItems.entryId,
        kcal: sql<number>`round(coalesce(sum(${foodItems.kcal}), 0)::numeric)`,
        items: sql<number>`count(*)`,
      })
      .from(foodItems)
      .where(
        inArray(
          foodItems.entryId,
          entries.map((entry) => entry.id),
        ),
      )
      .groupBy(foodItems.entryId);

    for (const row of rows) {
      sums.set(row.entryId, { kcal: Number(row.kcal), items: Number(row.items) });
    }
  }

  const doomed = entries.map((entry) => ({
    ...entry,
    kcal: sums.get(entry.id)?.kcal ?? 0,
    items: sums.get(entry.id)?.items ?? 0,
  }));

  console.log(`\nЗаписи владельца за ${TEST_DATE}: ${doomed.length}`);
  for (const entry of doomed) {
    console.log(
      `  ${entry.meal} — позиций ${entry.items}, ${entry.kcal} ккал  ${DIM}${entry.id}${RESET}`,
    );
  }

  const test = await db
    .select()
    .from(users)
    .where(inArray(users.telegramId, TEST_USERS));

  console.log(`\nПользователи от прогонов: ${test.length}`);
  for (const user of test) {
    console.log(
      `  tg ${user.telegramId}  ${user.firstName ?? ''} ${user.username ?? ''}`,
    );
  }

  if (!confirmed) {
    console.log(
      `\n${YELLOW}Ничего не удалено. Чтобы удалить, добавьте -- --yes${RESET}`,
    );
    return;
  }

  if (withEntries && doomed.length > 0) {
    await db.delete(foodEntries).where(
      inArray(
        foodEntries.id,
        doomed.map((entry) => entry.id),
      ),
    );
  }

  if (withUsers && test.length > 0) {
    // Каскадом уйдут их профили, цели, записи и тренировки — на них
    // никто больше не ссылается
    await db.delete(users).where(
      inArray(
        users.id,
        test.map((user) => user.id),
      ),
    );
  }

  const [left] = await db.select({ count: sql<number>`count(*)` }).from(users);

  console.log(
    `\nУдалено: записей ${withEntries ? doomed.length : 0}, ` +
      `пользователей ${withUsers ? test.length : 0}.`,
  );
  console.log(`Осталось пользователей: ${left?.count}`);
  console.log(
    `${DIM}Дневники остальных не тронуты: в проде есть живые записи, и они не наши.${RESET}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
