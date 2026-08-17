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
 *   npm run db:cleanup -- --yes
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

  const [owner] = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, OWNER_TG))
    .limit(1);

  const doomed = owner
    ? await db
        .select({
          id: foodEntries.id,
          meal: foodEntries.mealType,
          kcal: sql<number>`(
            select round(coalesce(sum(${foodItems.kcal}), 0)::numeric)
            from ${foodItems} where ${foodItems.entryId} = ${foodEntries.id}
          )`,
        })
        .from(foodEntries)
        .where(
          and(
            eq(foodEntries.userId, owner.id),
            eq(foodEntries.consumedOn, TEST_DATE),
          ),
        )
    : [];

  console.log(`\nЗаписи владельца за ${TEST_DATE}: ${doomed.length}`);
  for (const entry of doomed) {
    console.log(`  ${entry.meal} — ${entry.kcal} ккал  ${DIM}${entry.id}${RESET}`);
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

  if (doomed.length > 0) {
    await db.delete(foodEntries).where(
      inArray(
        foodEntries.id,
        doomed.map((entry) => entry.id),
      ),
    );
  }

  if (test.length > 0) {
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
    `\nУдалено: записей ${doomed.length}, пользователей ${test.length}.`,
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
