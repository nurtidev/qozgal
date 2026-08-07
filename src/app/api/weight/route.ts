import { z } from 'zod';
import { and, eq, gte, desc } from 'drizzle-orm';

import { route, parseBody, dateSchema } from '@/lib/api';
import { db } from '@/db';
import { weightLogs } from '@/db/schema';
import { localDate } from '@/db/queries';
import { movingAverageWeight } from '@/lib/health/composition';

const postSchema = z.object({
  weightKg: z.number().min(30, 'Меньше 30 кг').max(400, 'Больше 400 кг'),
  loggedOn: dateSchema.optional(),
  note: z.string().max(200).optional(),
});

/**
 * Взвешивание за день. Повторная отправка перезаписывает: человек может
 * взвеситься дважды и оставить второй результат, плодить записи за одну
 * дату незачем.
 */
export const POST = route(async ({ session, request }) => {
  const body = await parseBody(request, postSchema);
  const date = body.loggedOn ?? localDate(session.user.timezone);

  const [saved] = await db
    .insert(weightLogs)
    .values({
      userId: session.user.id,
      loggedOn: date,
      weightKg: body.weightKg,
      note: body.note ?? null,
    })
    .onConflictDoUpdate({
      target: [weightLogs.userId, weightLogs.loggedOn],
      set: { weightKg: body.weightKg, note: body.note ?? null },
    })
    .returning();

  return Response.json({ ok: true, loggedOn: saved.loggedOn, weightKg: saved.weightKg });
});

/**
 * История веса со скользящим средним.
 *
 * Среднее считается на сервере, потому что оно и есть главная цифра:
 * сырой ежедневный вес гуляет на ±1–1.5 кг от воды и полностью маскирует
 * реальный тренд при дефиците в полкило за неделю. Клиенту отдаём обе
 * величины, но рисовать он должен среднюю.
 */
export const GET = route(async ({ session, request }) => {
  const url = new URL(request.url);
  const days = Math.min(Number(url.searchParams.get('days') ?? 90), 365);

  const from = new Date();
  from.setDate(from.getDate() - days);
  const fromDate = from.toISOString().slice(0, 10);

  const logs = await db
    .select()
    .from(weightLogs)
    .where(
      and(
        eq(weightLogs.userId, session.user.id),
        gte(weightLogs.loggedOn, fromDate),
      ),
    )
    .orderBy(desc(weightLogs.loggedOn));

  const series = movingAverageWeight(
    logs.map((l) => ({ loggedOn: l.loggedOn, weightKg: l.weightKg })),
  );

  const first = series[0];
  const last = series[series.length - 1];

  return Response.json({
    series,
    // Изменение считаем по средним, а не по крайним точкам: две случайные
    // даты с разной задержкой воды дают «прогресс», которого не было
    change:
      first && last && series.length > 1
        ? Math.round((last.average - first.average) * 100) / 100
        : null,
    latest: last ? { date: last.date, raw: last.raw, average: last.average } : null,
  });
});
