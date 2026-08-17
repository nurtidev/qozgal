import type { Api } from 'grammy';
import { eq, desc, and } from 'drizzle-orm';

import { db } from '@/db';
import { users, weightLogs, bodyMeasurements, type User } from '@/db/schema';
import { localDate, localHour } from '@/db/queries';
import { translator, toLocale } from '@/i18n/messages';
import { shouldAskWeight, shouldAskWaist } from './reminders';

/**
 * Утренний вопрос про вес и, раз в две недели, про талию.
 *
 * Тем же интервалом, что переводит закреплённую сводку на новый день:
 * полночь и утро у каждого свои, и единственный способ попасть в чужое
 * утро — сверять локальное время каждые несколько минут.
 *
 * Ошибки проглатываются по той же причине, что и в сводке: напоминание —
 * удобство поверх дневника. Если человек заблокировал бота или удалил чат,
 * это не повод ронять цикл и лишить утреннего вопроса всех остальных.
 */

/** Кнопка отключения — она же единственное место, где о нём сказано */
export function remindersOffKeyboard(locale: 'ru' | 'kk') {
  return {
    inline_keyboard: [
      [
        {
          text: translator(locale)('bot.remindersOff'),
          callback_data: 'reminders:off',
        },
      ],
    ],
  };
}

async function hasWeightToday(user: User, date: string): Promise<boolean> {
  const [row] = await db
    .select({ id: weightLogs.id })
    .from(weightLogs)
    .where(and(eq(weightLogs.userId, user.id), eq(weightLogs.loggedOn, date)))
    .limit(1);

  return row !== undefined;
}

/** Дата последнего замера талии, если он был */
export async function lastWaistDate(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ measuredOn: bodyMeasurements.measuredOn })
    .from(bodyMeasurements)
    .where(eq(bodyMeasurements.userId, userId))
    .orderBy(desc(bodyMeasurements.measuredOn))
    .limit(1);

  return row?.measuredOn ?? null;
}

/**
 * Спрашивает вес у тех, у кого сейчас утро.
 *
 * Талия здесь не спрашивается намеренно: два вопроса подряд утром — уже
 * анкета. Про талию бот спросит в ответ на присланный вес, когда человек
 * и так стоит у зеркала.
 */
export async function askMorningWeight(api: Api): Promise<void> {
  const rows = await db.select().from(users).where(eq(users.remindersOn, true));

  for (const user of rows) {
    if (user.isBlocked) continue;

    const date = localDate(user.timezone);
    const ready = shouldAskWeight({
      remindersOn: user.remindersOn,
      hour: localHour(user.timezone),
      localDate: date,
      weightAskedOn: user.weightAskedOn,
      hasWeightToday: await hasWeightToday(user, date),
    });

    if (!ready) continue;

    const locale = toLocale(user.locale);

    try {
      await api.sendMessage(Number(user.telegramId), translator(locale)('bot.askWeight'), {
        reply_markup: remindersOffKeyboard(locale),
      });

      // Отметка ставится после отправки: если Telegram отказал, вопрос
      // повторится в следующий проход, а не пропадёт на сутки
      await db
        .update(users)
        .set({ weightAskedOn: date, awaitingInput: 'weight' })
        .where(eq(users.id, user.id));
    } catch {
      // Чат удалён или бот заблокирован — это не наше дело здесь
    }
  }
}

/* ──────────────────────── Запись присланных чисел ───────────────────── */

/** Записывает вес за сегодня; повторный ответ переписывает, а не дублирует */
export async function saveWeight(user: User, weightKg: number): Promise<void> {
  const date = localDate(user.timezone);

  await db
    .insert(weightLogs)
    .values({ userId: user.id, loggedOn: date, weightKg })
    .onConflictDoUpdate({
      target: [weightLogs.userId, weightLogs.loggedOn],
      set: { weightKg },
    });
}

/** Отменяет запись веса: человек прислал число, но имел в виду еду */
export async function undoWeight(user: User): Promise<void> {
  await db
    .delete(weightLogs)
    .where(
      and(
        eq(weightLogs.userId, user.id),
        eq(weightLogs.loggedOn, localDate(user.timezone)),
      ),
    );
}

/**
 * Записывает талию, достраивая запись от последнего замера.
 *
 * Обхват шеи в записи обязателен — он нужен для процента жира, — а в чате
 * мы спрашиваем только талию: три вопроса подряд превращают напоминание
 * в анкету. Шея и бёдра почти не меняются между замерами, поэтому берутся
 * из предыдущего; если предыдущего нет, талию в чате не спрашивают вовсе.
 *
 * @returns удалось ли записать
 */
export async function saveWaist(user: User, waistCm: number): Promise<boolean> {
  const [previous] = await db
    .select()
    .from(bodyMeasurements)
    .where(eq(bodyMeasurements.userId, user.id))
    .orderBy(desc(bodyMeasurements.measuredOn))
    .limit(1);

  if (!previous) return false;

  const date = localDate(user.timezone);

  await db
    .insert(bodyMeasurements)
    .values({
      userId: user.id,
      measuredOn: date,
      neckCm: previous.neckCm,
      waistCm,
      hipCm: previous.hipCm,
      chestCm: previous.chestCm,
      bicepsCm: previous.bicepsCm,
      thighCm: previous.thighCm,
      calfCm: previous.calfCm,
    })
    .onConflictDoUpdate({
      target: [bodyMeasurements.userId, bodyMeasurements.measuredOn],
      set: { waistCm },
    });

  return true;
}

/** Что бот ждёт от следующего числа в чате */
export async function setAwaiting(
  user: User,
  awaiting: 'weight' | 'waist' | null,
  waistAskedOn?: string,
): Promise<void> {
  await db
    .update(users)
    .set({
      awaitingInput: awaiting,
      ...(waistAskedOn ? { waistAskedOn } : {}),
    })
    .where(eq(users.id, user.id));
}
