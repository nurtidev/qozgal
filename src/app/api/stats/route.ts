import { and, eq, gte, sql } from 'drizzle-orm';

import { route } from '@/lib/api';
import { db } from '@/db';
import { foodEntries, foodItems } from '@/db/schema';
import { localDate, getActiveGoal } from '@/db/queries';
import { summarize, dateRange, type DayStat } from '@/lib/health/stats';

/**
 * История питания по дням и средние за период.
 *
 * Дневник отвечает на вопрос «что я съел сегодня», а этот отчёт — на
 * вопрос «как я ем вообще», ради которого дневник и ведут. Одного дня
 * для него мало: дефицит виден только на отрезке.
 *
 * Дни без записей возвращаются нулями и с entryCount: 0 — по ним видно
 * дыры в ведении дневника, и они намеренно не входят в среднее.
 * Пропущенный день — это не день без еды.
 */

/** Периоды те же, что на экране: неделя, месяц, квартал */
const MAX_DAYS = 92;

export const GET = route(async ({ session, request }) => {
  const url = new URL(request.url);
  const days = Math.min(
    Math.max(Number(url.searchParams.get('days') ?? 30), 1),
    MAX_DAYS,
  );

  const { user } = session;
  const today = localDate(user.timezone);
  const dates = dateRange(today, days);
  const from = dates[0];

  const rows = await db
    .select({
      date: foodEntries.consumedOn,
      kcal: sql<number>`coalesce(sum(${foodItems.kcal}), 0)`,
      proteinG: sql<number>`coalesce(sum(${foodItems.proteinG}), 0)`,
      fatG: sql<number>`coalesce(sum(${foodItems.fatG}), 0)`,
      carbsG: sql<number>`coalesce(sum(${foodItems.carbsG}), 0)`,
      entryCount: sql<number>`count(distinct ${foodEntries.id})`,
    })
    .from(foodEntries)
    .leftJoin(foodItems, eq(foodItems.entryId, foodEntries.id))
    .where(
      and(
        eq(foodEntries.userId, user.id),
        eq(foodEntries.status, 'confirmed'),
        gte(foodEntries.consumedOn, from),
      ),
    )
    .groupBy(foodEntries.consumedOn);

  const byDate = new Map(rows.map((row) => [row.date, row]));

  // Ряд идёт подряд по календарю: пропуски должны быть видны как пропуски,
  // а не сжиматься в непрерывную линию из тех дней, когда дневник вёлся
  const stats: DayStat[] = dates.map((date) => {
    const row = byDate.get(date);
    return {
      date,
      kcal: Math.round(Number(row?.kcal ?? 0)),
      proteinG: Math.round(Number(row?.proteinG ?? 0)),
      fatG: Math.round(Number(row?.fatG ?? 0)),
      carbsG: Math.round(Number(row?.carbsG ?? 0)),
      entryCount: Number(row?.entryCount ?? 0),
    };
  });

  const goal = await getActiveGoal(user.id);

  return Response.json({
    days: stats,
    goal: goal
      ? {
          kcalTarget: goal.kcalTarget,
          proteinTargetG: goal.proteinTargetG,
          fatTargetG: goal.fatTargetG,
          carbTargetG: goal.carbTargetG,
        }
      : null,
    summary: summarize(stats, goal?.kcalTarget ?? null),
  });
});
