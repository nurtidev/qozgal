import type { Api } from 'grammy';

import { db } from '@/db';
import { users, type User } from '@/db/schema';
import { eq, isNotNull } from 'drizzle-orm';
import {
  localDate,
  getDayTotals,
  getDayMeals,
  getDayWorkoutVolume,
  getActiveGoal,
} from '@/db/queries';
import { toLocale } from '@/i18n/messages';
import { formatDaySummary } from './summary';

/**
 * Закреплённая сводка дня.
 *
 * Одно сообщение на человека, которое бот переписывает после каждой записи
 * и закрепляет в чате. Смысл — сделать из чата приборную панель: остаток
 * дня виден в шапке, без открытия приложения и без прокрутки переписки.
 *
 * Почему одно сообщение, а не новое на каждую запись: закреплённым может
 * быть несколько, и Telegram показывает их по очереди — вместо панели
 * получилась бы вторая лента. Редактировать своё сообщение бот может
 * без ограничения по времени, так что одно живёт хоть месяц.
 *
 * Ошибки здесь намеренно проглатываются. Сводка — удобство поверх дневника,
 * и если Telegram отказал (сообщение удалено руками, слишком старое,
 * человек заблокировал бота), это не повод ронять сохранение записи,
 * ради которого он сюда пришёл.
 */

/** Дата в родительном падеже: «10 августа», «10 тамыз» */
function dateLabel(date: string, locale: 'ru' | 'kk'): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale === 'kk' ? 'kk-KZ' : 'ru-RU', {
    day: 'numeric',
    month: 'long',
  }).format(new Date(y, m - 1, d));
}

export async function refreshDaySummary(
  api: Api,
  user: User,
  chatId: number,
): Promise<void> {
  const date = localDate(user.timezone);
  const locale = toLocale(user.locale);

  const [totals, meals, goal, workoutVolumeKg] = await Promise.all([
    getDayTotals(user.id, date),
    getDayMeals(user.id, date),
    getActiveGoal(user.id),
    getDayWorkoutVolume(user.id, date),
  ]);

  const text = formatDaySummary({
    locale,
    date,
    dateLabel: dateLabel(date, locale),
    totals,
    meals,
    goal: goal
      ? {
          kcalTarget: goal.kcalTarget,
          proteinTargetG: goal.proteinTargetG,
          fatTargetG: goal.fatTargetG,
          carbTargetG: goal.carbTargetG,
        }
      : null,
    workoutVolumeKg,
  });

  // Сводка за прежний день не переписывается на сегодняшнюю: вчерашний
  // итог — это уже история, и превращать его в сегодняшний ноль значит
  // стереть у человека на глазах день, который он вёл
  const sameDay = user.pinnedSummaryOn === date && user.pinnedSummaryId !== null;

  if (sameDay) {
    try {
      await api.editMessageText(chatId, user.pinnedSummaryId!, text, {
        parse_mode: 'HTML',
      });
      return;
    } catch {
      // Сообщения нет — заведём новое ниже
    }
  }

  try {
    if (user.pinnedSummaryId) {
      await api.unpinChatMessage(chatId, user.pinnedSummaryId).catch(() => {});
    }

    const sent = await api.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      disable_notification: true,
    });
    await api.pinChatMessage(chatId, sent.message_id, {
      disable_notification: true,
    });

    await db
      .update(users)
      .set({ pinnedSummaryId: sent.message_id, pinnedSummaryOn: date })
      .where(eq(users.id, user.id));

    user.pinnedSummaryId = sent.message_id;
    user.pinnedSummaryOn = date;
  } catch {
    // Закрепить не вышло — дневник от этого не пострадал
  }
}

/**
 * Убирает из чата то, что уже стало записью: снимок и карточку разбора.
 *
 * Оба сообщения к этому моменту сделали свою работу — фотография разобрана,
 * карточка подтверждена, — а в переписке остаются навсегда. Удаление
 * ограничено 48 часами со стороны Telegram; черновик, подтверждённый
 * через неделю, просто останется в чате.
 */
export async function tidyEntryMessages(
  api: Api,
  chatId: number,
  messageIds: (number | null)[],
): Promise<void> {
  for (const id of messageIds) {
    if (!id) continue;
    await api.deleteMessage(chatId, id).catch(() => {});
  }
}

/**
 * Перевод закреплённых сводок на новый день.
 *
 * Без этого панель врёт до первой записи: человек открывает бота утром
 * и видит вчерашний итог с вчерашней датой — то есть ровно то, чего
 * закреплённое сообщение должно было избежать.
 *
 * Идём по всем, у кого сводка закреплена, и сверяем её дату с локальной
 * датой человека: часовые пояса разные, и «полночь» у каждого своя.
 */
export async function rollDailySummaries(api: Api): Promise<void> {
  const rows = await db
    .select()
    .from(users)
    .where(isNotNull(users.pinnedSummaryId));

  for (const user of rows) {
    if (user.isBlocked) continue;
    if (user.pinnedSummaryOn === localDate(user.timezone)) continue;

    // chat_id личного чата совпадает с идентификатором человека
    await refreshDaySummary(api, user, Number(user.telegramId));
  }
}
