import { Bot, InlineKeyboard, type Context } from 'grammy';

import { env, clientEnv } from '@/env';
import { recognizeFood, type ImageMediaType } from '@/lib/ai/recognize';
import { resolveItems, totalNutrition } from '@/lib/nutrition/resolve';
import {
  getOrCreateUser,
  createPendingEntry,
  confirmEntry,
  discardEntry,
  getDayTotals,
  getActiveGoal,
  getEntryMessages,
  localDate,
  localHour,
  recognitionsUsed,
} from '@/db/queries';
import { formatEntrySummary, escapeHtml, welcome } from './format';
import {
  saveWeight,
  undoWeight,
  saveWaist,
  setAwaiting,
  lastWaistDate,
  remindersOffKeyboard,
} from './ask-metrics';
import { parseMetric, looksLikeWeight, looksLikeWaist, shouldAskWaist } from './reminders';
import { refreshDaySummary, tidyEntryMessages } from './pinned';
import { translator, toLocale, type Locale } from '@/i18n/messages';
import { db } from '@/db';
import { users, type User } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Язык ответа.
 *
 * До обращения к базе он берётся из апдейта — тем же полем, по которому
 * getOrCreateUser проставляет locale пользователю. Часть ответов (неверный
 * тип файла, слишком большой файл) уходит раньше, чем мы вообще заводим
 * человека в базе, и ждать ради этого запроса к Postgres незачем.
 */
function speak(source: { language_code?: string } | User | undefined) {
  if (!source) return translator('ru');
  const code =
    'locale' in source ? source.locale : source.language_code;
  return translator(toLocale(code));
}

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

/* ──────────────────────────── Клавиатуры ───────────────────────────── */

function appKeyboard(locale: Locale): InlineKeyboard {
  return new InlineKeyboard().webApp(
    translator(locale)('bot.openApp'),
    clientEnv.NEXT_PUBLIC_APP_URL,
  );
}

function confirmKeyboard(entryId: string, locale: Locale): InlineKeyboard {
  const t = translator(locale);
  return new InlineKeyboard()
    .text(t('bot.save'), `confirm:${entryId}`)
    .webApp(t('bot.edit'), `${clientEnv.NEXT_PUBLIC_APP_URL}/entry/${entryId}`)
    .row()
    .text(t('bot.cancel'), `discard:${entryId}`);
}

/* ──────────────────────────── Команды ──────────────────────────────── */

bot.command('start', async (ctx) => {
  const locale = toLocale(ctx.from?.language_code);
  await ctx.reply(welcome(locale), {
    parse_mode: 'HTML',
    reply_markup: appKeyboard(locale),
  });

  // Сводка появляется сразу, а не после первой записи: иначе человек
  // увидит закреплённое сообщение неизвестно откуда посреди дня
  const user = await resolveUser(ctx);
  if (user) await refreshDaySummary(ctx.api, user, ctx.chat.id);
});

/**
 * Переключатель уборки чата.
 *
 * Команда скрытая, в меню её нет: она нужна тем немногим, кто листает
 * чат как историю питания, а объяснять её всем остальным — значит
 * навязывать выбор там, где разумное поведение и так по умолчанию.
 */
bot.command('tidy', async (ctx) => {
  const user = await resolveUser(ctx);
  if (!user) return;

  const next = !user.tidyChat;
  await db.update(users).set({ tidyChat: next }).where(eq(users.id, user.id));
  await ctx.reply(speak(user)(next ? 'bot.tidyOn' : 'bot.tidyOff'));
});

/**
 * Переключатель утренних вопросов.
 *
 * Отключить можно и кнопкой под самим вопросом — так человек находит выход
 * там, где он ему понадобился. Команда нужна, чтобы включить обратно.
 */
bot.command('reminders', async (ctx) => {
  const user = await resolveUser(ctx);
  if (!user) return;

  const next = !user.remindersOn;
  await db
    .update(users)
    .set({ remindersOn: next, awaitingInput: null })
    .where(eq(users.id, user.id));

  await ctx.reply(
    speak(user)(next ? 'bot.remindersEnabled' : 'bot.remindersDisabled'),
  );
});

bot.callbackQuery('reminders:off', async (ctx) => {
  const user = await resolveUser(ctx);
  if (!user) return;

  await db
    .update(users)
    .set({ remindersOn: false, awaitingInput: null })
    .where(eq(users.id, user.id));

  await ctx.answerCallbackQuery();
  // Кнопку убираем: она отработала, и повторное нажатие ничего не изменит
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  await ctx.reply(speak(user)('bot.remindersDisabled'));
});

bot.callbackQuery('weight:undo', async (ctx) => {
  const user = await resolveUser(ctx);
  if (!user) return;

  await undoWeight(user);
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
  await ctx.reply(speak(user)('bot.weightUndone'));
});

bot.command('app', async (ctx) => {
  const locale = toLocale(ctx.from?.language_code);
  await ctx.reply(translator(locale)('bot.appPrompt'), {
    reply_markup: appKeyboard(locale),
  });
});

bot.command('today', async (ctx) => {
  const user = await resolveUser(ctx);
  if (!user) return;

  const t = speak(user);
  const date = localDate(user.timezone);
  const [totals, goal] = await Promise.all([
    getDayTotals(user.id, date),
    getActiveGoal(user.id),
  ]);

  if (totals.entryCount === 0) {
    await ctx.reply(t('bot.todayEmpty'));
    return;
  }

  const lines = [
    `<b>${t('bot.todayTitle')}</b>`,
    ``,
    `<b>${t('bot.todayEaten', { kcal: totals.kcal })}</b>`,
    t('macros.short', {
      protein: totals.proteinG,
      fat: totals.fatG,
      carbs: totals.carbsG,
    }),
  ];

  if (goal) {
    const left = goal.kcalTarget - totals.kcal;
    lines.push('');
    lines.push(
      left >= 0
        ? t('bot.todayLeft', { target: goal.kcalTarget, left })
        : t('bot.todayOver', {
            target: goal.kcalTarget,
            over: Math.abs(left),
          }),
    );
  }

  await ctx.reply(lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: appKeyboard(toLocale(user.locale)),
  });
});

/* ───────────────────────── Разбор фотографии ───────────────────────── */

bot.on('message:photo', async (ctx) => {
  const user = await resolveUser(ctx);
  if (!user) return;
  if (!(await withinRecognitionLimit(ctx, user))) return;

  const t = speak(user);
  const status = await ctx.reply(t('bot.analyzingPhoto'));

  try {
    const photo = pickPhotoSize(ctx.message.photo);
    if (!photo) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        status.message_id,
        t('bot.noImage'),
      );
      return;
    }

    const imageBase64 = await downloadPhoto(photo.file_id);

    await handleRecognition(ctx, user, status.message_id, {
      imageBase64,
      imageMediaType: 'image/jpeg',
      text: ctx.message.caption,
      // file_id, а не готовая ссылка: URL файла Telegram содержит токен бота,
      // и хранить его в базе нельзя.
      photoRef: `tg:${photo.file_id}`,
      source: 'photo',
      rawInput: ctx.message.caption,
      userMessageId: ctx.message.message_id,
    });
  } catch (error) {
    await reportFailure(ctx, status.message_id, error);
  }
});

/* ───────────────── Фото, отправленное файлом «без сжатия» ──────────── */

/** Форматы, которые понимает модель */
const IMAGE_MIME: Record<string, ImageMediaType> = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
};

/** Ограничение API на изображение — 5 МБ в base64, берём запас */
const MAX_DOCUMENT_BYTES = 3.5 * 1024 * 1024;

/**
 * Телефон отправляет снимок сжатым, но часть людей шлёт «как файл», чтобы
 * не терять качество. Без этого обработчика такое сообщение молча уходило
 * в никуда: бот слушал только message:photo, а документ не подходил ни под
 * один фильтр — пользователь не получал даже сообщения об ошибке.
 *
 * Оговорка по стоимости: у документа нет лестницы размеров, поэтому
 * изображение уходит в модель как есть. Снимок с современного телефона
 * может весить в разы больше, чем выбранный нами 1000-пиксельный вариант
 * для обычного фото. Если такие отправки станут заметной долей, стоит
 * добавить уменьшение на нашей стороне.
 */
bot.on('message:document', async (ctx) => {
  const doc = ctx.message.document;
  const mediaType = doc.mime_type ? IMAGE_MIME[doc.mime_type] : undefined;
  const t = speak(ctx.from);

  if (!mediaType) {
    await ctx.reply(t('bot.unsupported'));
    return;
  }

  if (doc.file_size && doc.file_size > MAX_DOCUMENT_BYTES) {
    await ctx.reply(t('bot.tooLarge'));
    return;
  }

  const user = await resolveUser(ctx);
  if (!user) return;
  if (!(await withinRecognitionLimit(ctx, user))) return;

  const status = await ctx.reply(t('bot.analyzingPhoto'));

  try {
    const imageBase64 = await downloadPhoto(doc.file_id);
    await handleRecognition(ctx, user, status.message_id, {
      imageBase64,
      imageMediaType: mediaType,
      text: ctx.message.caption,
      photoRef: `tg:${doc.file_id}`,
      source: 'photo',
      rawInput: ctx.message.caption,
      userMessageId: ctx.message.message_id,
    });
  } catch (error) {
    await reportFailure(ctx, status.message_id, error);
  }
});

/* ────────────────────── Разбор текстового описания ─────────────────── */

bot.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  const user = await resolveUser(ctx);
  if (!user) return;

  // Число без слов — это замер, а не еда. Проверяем до вызова модели:
  // «73.4» стоило бы разбора фотографии, а ответ был бы бессмысленным
  if (await handleMetric(ctx, user)) return;

  if (!(await withinRecognitionLimit(ctx, user))) return;

  const status = await ctx.reply(speak(user)('bot.analyzingText'));

  try {
    await handleRecognition(ctx, user, status.message_id, {
      text: ctx.message.text,
      source: 'text',
      rawInput: ctx.message.text,
      userMessageId: ctx.message.message_id,
    });
  } catch (error) {
    await reportFailure(ctx, status.message_id, error);
  }
});

/**
 * Служебная строчка «бот закрепил сообщение».
 *
 * Появляется при каждом закреплении и копится в чате — то есть ровно
 * то, от чего закреплённая сводка и должна была избавить. Удаляем молча.
 */
bot.on('message:pinned_message', async (ctx) => {
  await ctx.api
    .deleteMessage(ctx.chat.id, ctx.message.message_id)
    .catch(() => {});
});

/**
 * Всё остальное, что можно прислать в чат.
 *
 * Обработчик стоит последним и ловит то, что не подошло ни под один
 * предыдущий: голосовые, кружки, стикеры, геометки. Раньше такое
 * сообщение уходило в тишину, и человек оставался с вопросом, дошло ли
 * оно вообще, — а молчание в ответ читается как поломка.
 *
 * Голосовым отвечаем отдельно: их присылают не по ошибке, а потому что
 * это самый быстрый способ описать съеденное. Пока мы их не разбираем,
 * и честнее сказать это прямо, чем предлагать общий список умений.
 */
bot.on('message:voice', async (ctx) => {
  await ctx.reply(speak(ctx.from)('bot.voiceUnsupported'));
});

bot.on('message', async (ctx) => {
  await ctx.reply(speak(ctx.from)('bot.unsupported'));
});

/* ────────────────────── Подтверждение и отмена ─────────────────────── */

bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
  const user = await resolveUser(ctx);
  if (!user) return;

  const t = speak(user);
  const entryId = ctx.match[1];
  const ok = await confirmEntry(entryId, user.id);

  if (!ok) {
    await ctx.answerCallbackQuery({ text: t('bot.entryNotFound') });
    return;
  }

  const date = localDate(user.timezone);
  const [totals, goal] = await Promise.all([
    getDayTotals(user.id, date),
    getActiveGoal(user.id),
  ]);

  const tail =
    '\n\n' +
    (goal
      ? t('bot.dayTotal', { kcal: totals.kcal, target: goal.kcalTarget })
      : t('bot.dayTotalNoGoal', { kcal: totals.kcal }));

  await ctx.answerCallbackQuery({ text: t('bot.saved') });

  const chatId = ctx.chat?.id;

  /**
   * Чистый чат: снимок и карточка разбора своё уже отработали, а в
   * переписке остаются навсегда. Вместо них человек видит закреплённую
   * сводку дня, которая обновляется на месте.
   */
  if (user.tidyChat && chatId) {
    const messages = await getEntryMessages(entryId, user.id);
    await tidyEntryMessages(ctx.api, chatId, [
      messages?.userMessageId ?? null,
      messages?.botMessageId ?? null,
    ]);
    await refreshDaySummary(ctx.api, user, chatId);
    return;
  }

  if (chatId) await refreshDaySummary(ctx.api, user, chatId);

  // Разметку переносим через entities, а не через parse_mode.
  // message.text отдаёт текст уже без тегов, поэтому повторная отправка
  // с parse_mode: 'HTML' рендерила бы его без жирного и курсива —
  // сохранённая запись выглядела бы беднее, чем та же карточка до нажатия.
  // Хвост дописывается в конец, поэтому смещения существующих entities
  // остаются верными и переносятся как есть.
  const original = ctx.callbackQuery.message;
  const text =
    (original && 'text' in original ? original.text : null) ?? t('bot.recorded');
  const entities =
    original && 'entities' in original ? original.entities : undefined;

  await ctx.editMessageText(`${text}${tail}`, { entities });
});

bot.callbackQuery(/^discard:(.+)$/, async (ctx) => {
  const user = await resolveUser(ctx);
  if (!user) return;

  const t = speak(user);
  await discardEntry(ctx.match[1], user.id);
  await ctx.answerCallbackQuery({ text: t('bot.discarded') });
  await ctx.editMessageText(t('bot.discardedText'));
});

/* ─────────────────────── Общая логика разбора ──────────────────────── */

interface RecognitionRequest {
  imageBase64?: string;
  imageMediaType?: ImageMediaType;
  text?: string;
  photoRef?: string;
  source: 'photo' | 'text';
  rawInput?: string;
  /** Сообщение, с которого начался разбор — по нему чат убирается */
  userMessageId?: number;
}

async function handleRecognition(
  ctx: Context,
  user: User,
  statusMessageId: number,
  request: RecognitionRequest,
) {
  const chatId = ctx.chat!.id;

  const outcome = await recognizeFood({
    imageBase64: request.imageBase64,
    imageMediaType: request.imageMediaType,
    text: request.text,
    localHour: localHour(user.timezone),
  });

  if (!outcome.ok) {
    // Причина приходит кодом, текст берём из словаря: сообщение об ошибке
    // на чужом языке — то же самое, что и ошибка без объяснения.
    //
    // «Еды не нашлось» звучит по-разному для снимка и для описания:
    // человеку, написавшему «привет», ответ про фотографию говорит, что
    // бот его не понял, — а он не понял бота
    const t = speak(user);
    const text =
      outcome.reason === 'not_food' && request.source === 'text'
        ? t('bot.failure.not_food_text')
        : t(`bot.failure.${outcome.reason}`);

    await ctx.api.editMessageText(chatId, statusMessageId, text);
    return;
  }

  const resolved = await resolveItems(outcome.recognition.items);
  const total = totalNutrition(resolved);

  const entryId = await createPendingEntry({
    userId: user.id,
    timezone: user.timezone,
    mealType: outcome.recognition.mealType,
    source: request.source,
    resolved,
    recognition: outcome.recognition,
    photoUrl: request.photoRef,
    rawInput: request.rawInput,
    userMessageId: request.userMessageId,
    aiModel: outcome.meta.model,
    aiLatencyMs: outcome.meta.latencyMs,
    // Карточка уедет в это же сообщение — запоминаем его, чтобы Mini App
    // могло погасить кнопки после подтверждения
    botChatId: chatId,
    botMessageId: statusMessageId,
  });

  const [totals, goal] = await Promise.all([
    getDayTotals(user.id, localDate(user.timezone)),
    getActiveGoal(user.id),
  ]);

  const summary = formatEntrySummary({
    recognition: outcome.recognition,
    resolved,
    total,
    dayKcal: totals.kcal + total.kcal,
    dayTargetKcal: goal?.kcalTarget,
    locale: toLocale(user.locale),
  });

  await ctx.api.editMessageText(chatId, statusMessageId, summary, {
    parse_mode: 'HTML',
    reply_markup: confirmKeyboard(entryId, toLocale(user.locale)),
  });
}

/* ──────────────────────────── Утилиты ──────────────────────────────── */

async function resolveUser(ctx: Context): Promise<User | null> {
  if (!ctx.from) return null;

  const user = await getOrCreateUser({
    id: ctx.from.id,
    username: ctx.from.username,
    firstName: ctx.from.first_name,
    lastName: ctx.from.last_name,
    languageCode: ctx.from.language_code,
  });

  if (user.isBlocked) {
    await ctx.reply(speak(user)('bot.blocked'));
    return null;
  }

  return user;
}

/** Ширина, начиная с которой разрешение перестаёт улучшать разбор */
const TARGET_PHOTO_WIDTH = 1000;

/**
 * Выбирает размер фотографии из лестницы, которую отдаёт Telegram.
 *
 * Не самый крупный: замеры на одном и том же блюде показали, что оценка
 * веса от разрешения практически не зависит, а стоимость зависит сильно.
 * На фотографии бешбармака 1920 px против 1024 px дали одинаковые
 * 450 г и 250 г, но 2981 против 865 входных токенов — то есть 2.49¢
 * против 1.36¢ за разбор и 9.6 против 7.8 секунды ожидания.
 * При пяти приёмах пищи в день это разница в $3.73 и $2.04 на
 * пользователя в месяц.
 *
 * Берём наименьший размер шириной от TARGET_PHOTO_WIDTH; если оригинал
 * мельче — самый крупный из доступных.
 *
 * Оговорка: замер сделан на крупном блюде. Для тарелки с множеством
 * мелких позиций разрешение может оказаться важнее — если разбор салатов
 * начнёт мазать, поднимите порог.
 */
function pickPhotoSize<T extends { width: number }>(sizes: readonly T[]): T | undefined {
  if (sizes.length === 0) return undefined;

  // Telegram отдаёт размеры по возрастанию, но полагаться на это не станем
  const sorted = [...sizes].sort((a, b) => a.width - b.width);
  return (
    sorted.find((s) => s.width >= TARGET_PHOTO_WIDTH) ?? sorted[sorted.length - 1]
  );
}

async function downloadPhoto(fileId: string): Promise<string> {
  const file = await bot.api.getFile(fileId);
  if (!file.file_path) throw new Error('Telegram не вернул путь к файлу');

  const response = await fetch(
    `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`,
    { signal: AbortSignal.timeout(15_000) },
  );

  if (!response.ok) {
    throw new Error(`Скачивание файла не удалось: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer()).toString('base64');
}

/**
 * Сколько разборов в час и в сутки может запросить один человек.
 *
 * Лимит не про деньги — десять пользователей бюджет не съедят. Он про то,
 * что один увлёкшийся тестировщик, отправивший подряд пятьдесят фото,
 * упирается в rate limit модели и в часовую квоту USDA, а разбор после
 * этого падает у всех остальных: лимиты общие на приложение, а не на
 * человека. Дешевле притормозить одного, чем сломать всем.
 *
 * Числа с запасом: пять приёмов пищи в день — обычная норма, тридцать
 * в час не наберёт никто, кто действительно ведёт дневник.
 */
const MAX_RECOGNITIONS_PER_HOUR = 30;
const MAX_RECOGNITIONS_PER_DAY = 100;

/**
 * Проверка лимита до сообщения «анализирую»: иначе человек увидел бы
 * обещание разобрать снимок, которое тут же сменилось бы отказом.
 */
async function withinRecognitionLimit(
  ctx: Context,
  user: User,
): Promise<boolean> {
  const used = await recognitionsUsed(user.id);

  if (
    used.hour < MAX_RECOGNITIONS_PER_HOUR &&
    used.day < MAX_RECOGNITIONS_PER_DAY
  ) {
    return true;
  }

  const t = speak(user);
  const perHour = used.hour >= MAX_RECOGNITIONS_PER_HOUR;

  console.warn(
    `Лимит разборов у ${user.telegramId}: ${used.hour}/час, ${used.day}/сутки`,
  );

  await ctx.reply(
    perHour
      ? t('bot.limitHour', { limit: MAX_RECOGNITIONS_PER_HOUR })
      : t('bot.limitDay', { limit: MAX_RECOGNITIONS_PER_DAY }),
  );

  return false;
}

/**
 * Замер вместо еды.
 *
 * Число без слов в чате — это вес или талия, и разбирать его моделью
 * бессмысленно: «73.4» не блюдо. Талия принимается только когда бот сам
 * о ней спросил: «200» одинаково подходит под килограммы и сантиметры,
 * и различить их можно лишь по тому, о чём шёл разговор.
 *
 * Запись веса обратима кнопкой: человек мог иметь в виду «200» граммов
 * чего-то и не написать, чего именно.
 *
 * @returns взяли ли сообщение на себя
 */
async function handleMetric(ctx: Context, user: User): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text) return false;

  const value = parseMetric(text);
  if (value === null) return false;

  const t = speak(user);

  if (user.awaitingInput === 'waist') {
    if (!looksLikeWaist(value)) return false;

    const saved = await saveWaist(user, value);
    await setAwaiting(user, null);
    await ctx.reply(
      saved ? t('bot.waistSaved', { waist: value }) : t('bot.waistNeedsApp'),
    );
    return true;
  }

  if (!looksLikeWeight(value)) return false;

  await saveWeight(user, value);
  await setAwaiting(user, null);

  await ctx.reply(t('bot.weightSaved', { weight: value }), {
    reply_markup: new InlineKeyboard().text(t('bot.notWeight'), 'weight:undo'),
  });

  // Про талию спрашиваем вслед за весом: человек уже стоит у зеркала,
  // а отдельное сообщение утром превратило бы напоминание в анкету
  const date = localDate(user.timezone);
  const ready = shouldAskWaist({
    localDate: date,
    lastWaistOn: await lastWaistDate(user.id),
    waistAskedOn: user.waistAskedOn,
  });

  if (ready) {
    await ctx.reply(t('bot.askWaist'));
    await setAwaiting(user, 'waist', date);
  }

  return true;
}

async function reportFailure(
  ctx: Context,
  statusMessageId: number,
  error: unknown,
) {
  console.error('Разбор не удался:', error);
  try {
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMessageId,
      speak(ctx.from)('bot.failed'),
    );
  } catch {
    // Сообщение могли удалить, пока шёл разбор — это не повод падать
  }
}

bot.catch((err) => {
  console.error(`Ошибка в обработчике апдейта ${err.ctx.update.update_id}:`, err.error);
});

export { escapeHtml };
