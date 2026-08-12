import { and, eq, sql, desc, inArray } from 'drizzle-orm';
import { db } from './index';
import {
  users,
  goals,
  weightLogs,
  foodEntries,
  foodItems,
  workoutSessions,
  workoutSets,
  type User,
  type MealType,
} from './schema';
import { toLocale } from '@/i18n/messages';
import type { ResolvedItem } from '@/lib/nutrition/resolve';
import type { Recognition } from '@/lib/ai/schemas';

/* ────────────────────── Локальное время пользователя ───────────────── */

/**
 * Дата в часовом поясе пользователя в формате YYYY-MM-DD.
 *
 * Считать «день» по UTC нельзя: для Алматы (UTC+5) ужин в 21:00 попал бы
 * в UTC-сутки текущего дня, а завтрак в 08:00 — в предыдущие, и дневной
 * итог разъехался бы с тем, что человек реально съел за день.
 */
export function localDate(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Локальный час пользователя — подсказка модели о приёме пищи */
export function localHour(timezone: string, at: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hour12: false,
    }).format(at),
  );
}

/* ───────────────────────── Пользователи ────────────────────────────── */

export interface TelegramIdentity {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
}

/**
 * Находит или создаёт пользователя по данным из апдейта бота.
 *
 * В отличие от веб-части, здесь личность подтверждена самим Telegram:
 * апдейт пришёл на вебхук с секретом либо получен long-polling'ом по
 * токену бота, подделать отправителя в этом канале нельзя.
 */
export async function getOrCreateUser(
  identity: TelegramIdentity,
): Promise<User> {
  const now = new Date();
  const [user] = await db
    .insert(users)
    .values({
      telegramId: BigInt(identity.id),
      username: identity.username ?? null,
      firstName: identity.firstName ?? null,
      lastName: identity.lastName ?? null,
      locale: toLocale(identity.languageCode),
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      // Язык обновляется на каждом апдейте: переключив клиент Telegram
      // на казахский, человек ждёт казахский и от бота
      set: { locale: toLocale(identity.languageCode), lastSeenAt: now, updatedAt: now },
    })
    .returning();

  return user;
}

/* ──────────────────────── Дневник питания ──────────────────────────── */

export interface CreateEntryInput {
  userId: string;
  timezone: string;
  mealType: MealType;
  source: 'photo' | 'text' | 'repeat' | 'barcode' | 'manual';
  resolved: ResolvedItem[];
  recognition?: Recognition;
  photoUrl?: string;
  rawInput?: string;
  aiModel?: string;
  aiLatencyMs?: number;
  /** Сообщение бота с карточкой — по нему приложение гасит кнопки */
  botChatId?: number;
  botMessageId?: number;
  /** Сообщение человека, с которого начался разбор — по нему чат убирается */
  userMessageId?: number;
}

/**
 * Создаёт запись в статусе pending — она ещё не учитывается в дневном итоге.
 * Пока пользователь не подтвердил разбор, цифры считаются черновиком:
 * иначе достаточно одного неудачного распознавания, чтобы день был испорчен.
 */
export async function createPendingEntry(
  input: CreateEntryInput,
): Promise<string> {
  const now = new Date();

  return db.transaction(async (tx) => {
    const [entry] = await tx
      .insert(foodEntries)
      .values({
        userId: input.userId,
        consumedAt: now,
        consumedOn: localDate(input.timezone, now),
        mealType: input.mealType,
        source: input.source,
        status: 'pending',
        photoUrl: input.photoUrl ?? null,
        rawInput: input.rawInput ?? null,
        botChatId: input.botChatId ?? null,
        botMessageId: input.botMessageId ?? null,
        userMessageId: input.userMessageId ?? null,
        aiModel: input.aiModel ?? null,
        aiRawResponse: input.recognition ?? null,
        aiLatencyMs: input.aiLatencyMs ?? null,
      })
      .returning({ id: foodEntries.id });

    const rows = input.resolved.map((r, index) => ({
      entryId: entry.id,
      productId: r.product?.id ?? null,
      nameRaw: r.item.nameRu,
      grams: r.item.grams,
      kcal: r.nutrition?.kcal ?? 0,
      proteinG: r.nutrition?.proteinG ?? 0,
      fatG: r.nutrition?.fatG ?? 0,
      carbsG: r.nutrition?.carbsG ?? 0,
      aiConfidence: r.item.confidence,
      aiEstimatedGrams: r.item.grams,
      sortOrder: index,
    }));

    if (rows.length > 0) {
      await tx.insert(foodItems).values(rows);
    }

    return entry.id;
  });
}

/** Сообщения, из которых выросла запись: снимок человека и карточка бота */
export async function getEntryMessages(entryId: string, userId: string) {
  const [row] = await db
    .select({
      botChatId: foodEntries.botChatId,
      botMessageId: foodEntries.botMessageId,
      userMessageId: foodEntries.userMessageId,
    })
    .from(foodEntries)
    .where(and(eq(foodEntries.id, entryId), eq(foodEntries.userId, userId)))
    .limit(1);

  return row ?? null;
}

/** Подтверждает разбор — только после этого запись попадает в дневной итог */
export async function confirmEntry(
  entryId: string,
  userId: string,
): Promise<boolean> {
  const updated = await db
    .update(foodEntries)
    .set({ status: 'confirmed', updatedAt: new Date() })
    // Проверка userId обязательна: идентификатор записи приходит из
    // callback_data, а её можно подставить руками в любом клиенте.
    .where(and(eq(foodEntries.id, entryId), eq(foodEntries.userId, userId)))
    .returning({ id: foodEntries.id });

  return updated.length > 0;
}

export async function discardEntry(
  entryId: string,
  userId: string,
): Promise<boolean> {
  const updated = await db
    .update(foodEntries)
    .set({ status: 'discarded', updatedAt: new Date() })
    .where(and(eq(foodEntries.id, entryId), eq(foodEntries.userId, userId)))
    .returning({ id: foodEntries.id });

  return updated.length > 0;
}

export interface DayTotals {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  entryCount: number;
}

/** Итог за день — учитываются только подтверждённые записи */
export async function getDayTotals(
  userId: string,
  date: string,
): Promise<DayTotals> {
  const [row] = await db
    .select({
      kcal: sql<number>`coalesce(sum(${foodItems.kcal}), 0)`,
      proteinG: sql<number>`coalesce(sum(${foodItems.proteinG}), 0)`,
      fatG: sql<number>`coalesce(sum(${foodItems.fatG}), 0)`,
      carbsG: sql<number>`coalesce(sum(${foodItems.carbsG}), 0)`,
      entryCount: sql<number>`count(distinct ${foodEntries.id})`,
    })
    .from(foodEntries)
    .innerJoin(foodItems, eq(foodItems.entryId, foodEntries.id))
    .where(
      and(
        eq(foodEntries.userId, userId),
        eq(foodEntries.consumedOn, date),
        eq(foodEntries.status, 'confirmed'),
      ),
    );

  return {
    kcal: Math.round(Number(row?.kcal ?? 0)),
    proteinG: Math.round(Number(row?.proteinG ?? 0) * 10) / 10,
    fatG: Math.round(Number(row?.fatG ?? 0) * 10) / 10,
    carbsG: Math.round(Number(row?.carbsG ?? 0) * 10) / 10,
    entryCount: Number(row?.entryCount ?? 0),
  };
}

/**
 * Приёмы пищи за день для закреплённой сводки: только подтверждённые
 * и только итог по каждому — состав в сводке не нужен, он есть в дневнике.
 */
export async function getDayMeals(
  userId: string,
  date: string,
): Promise<{ mealType: MealType; kcal: number }[]> {
  const rows = await db
    .select({
      id: foodEntries.id,
      mealType: foodEntries.mealType,
      consumedAt: foodEntries.consumedAt,
      kcal: sql<number>`coalesce(sum(${foodItems.kcal}), 0)`,
    })
    .from(foodEntries)
    .leftJoin(foodItems, eq(foodItems.entryId, foodEntries.id))
    .where(
      and(
        eq(foodEntries.userId, userId),
        eq(foodEntries.consumedOn, date),
        eq(foodEntries.status, 'confirmed'),
      ),
    )
    .groupBy(foodEntries.id, foodEntries.mealType, foodEntries.consumedAt)
    .orderBy(foodEntries.consumedAt);

  return rows.map((row) => ({
    mealType: row.mealType,
    kcal: Math.round(Number(row.kcal)),
  }));
}

/**
 * Тоннаж сегодняшних тренировок.
 *
 * В сводке он показывается фактом и не превращается в калории: расход
 * уже учтён коэффициентом активности в норме, и показать его рядом
 * с остатком значило бы предложить эти калории съесть.
 */
export async function getDayWorkoutVolume(
  userId: string,
  date: string,
): Promise<number> {
  const [row] = await db
    .select({
      volume: sql<number>`coalesce(sum(coalesce(${workoutSets.weightKg}, 0) * coalesce(${workoutSets.reps}, 0)), 0)`,
    })
    .from(workoutSessions)
    .leftJoin(workoutSets, eq(workoutSets.sessionId, workoutSessions.id))
    .where(
      and(
        eq(workoutSessions.userId, userId),
        eq(workoutSessions.performedOn, date),
      ),
    );

  return Math.round(Number(row?.volume ?? 0));
}

/** Последнее взвешивание — нужно там, где расчёт идёт от веса тела */
export async function latestWeight(userId: string) {
  const [row] = await db
    .select()
    .from(weightLogs)
    .where(eq(weightLogs.userId, userId))
    .orderBy(desc(weightLogs.loggedOn))
    .limit(1);

  return row ?? null;
}

/** Активная цель пользователя — из неё берётся дневная норма калорий */
export async function getActiveGoal(userId: string) {
  const [goal] = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.isActive, true)))
    .orderBy(desc(goals.createdAt))
    .limit(1);

  return goal ?? null;
}

/* ────────────────────────── Ограничение разборов ───────────────────── */

/**
 * Сколько разборов человек запросил за последние сутки и за последний час.
 *
 * Считаются только записи, для которых вызывалась модель: повтор блюда
 * и ручной ввод ничего не стоят и в лимит не идут.
 *
 * Отдельной таблицы под счётчик нет намеренно: записи и так лежат в базе
 * с временем создания, а счётчик в памяти бота обнулялся бы при каждом
 * перезапуске контейнера — то есть при каждом деплое.
 */
export async function recognitionsUsed(
  userId: string,
): Promise<{ hour: number; day: number }> {
  const [row] = await db
    .select({
      hour: sql<number>`count(*) filter (
        where ${foodEntries.createdAt} > now() - interval '1 hour'
      )`,
      day: sql<number>`count(*) filter (
        where ${foodEntries.createdAt} > now() - interval '1 day'
      )`,
    })
    .from(foodEntries)
    .where(
      and(
        eq(foodEntries.userId, userId),
        inArray(foodEntries.source, ['photo', 'text']),
        sql`${foodEntries.createdAt} > now() - interval '1 day'`,
      ),
    );

  return { hour: Number(row?.hour ?? 0), day: Number(row?.day ?? 0) };
}
