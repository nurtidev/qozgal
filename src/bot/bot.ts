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
  localDate,
  localHour,
} from '@/db/queries';
import { formatEntrySummary, escapeHtml, WELCOME } from './format';
import type { User } from '@/db/schema';

export const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

/* ──────────────────────────── Клавиатуры ───────────────────────────── */

function appKeyboard(): InlineKeyboard {
  return new InlineKeyboard().webApp(
    'Открыть приложение',
    clientEnv.NEXT_PUBLIC_APP_URL,
  );
}

function confirmKeyboard(entryId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✓ Сохранить', `confirm:${entryId}`)
    .webApp('✏️ Поправить', `${clientEnv.NEXT_PUBLIC_APP_URL}/entry/${entryId}`)
    .row()
    .text('✕ Отмена', `discard:${entryId}`);
}

/* ──────────────────────────── Команды ──────────────────────────────── */

bot.command('start', async (ctx) => {
  await ctx.reply(WELCOME, {
    parse_mode: 'HTML',
    reply_markup: appKeyboard(),
  });
});

bot.command('app', async (ctx) => {
  await ctx.reply('Дашборд, замеры и план питания:', {
    reply_markup: appKeyboard(),
  });
});

bot.command('today', async (ctx) => {
  const user = await resolveUser(ctx);
  if (!user) return;

  const date = localDate(user.timezone);
  const [totals, goal] = await Promise.all([
    getDayTotals(user.id, date),
    getActiveGoal(user.id),
  ]);

  if (totals.entryCount === 0) {
    await ctx.reply(
      'За сегодня записей пока нет. Пришлите фото блюда или опишите словами.',
    );
    return;
  }

  const lines = [
    `<b>Сегодня</b>`,
    ``,
    `Съедено: <b>${totals.kcal} ккал</b>`,
    `Б ${totals.proteinG} · Ж ${totals.fatG} · У ${totals.carbsG}`,
  ];

  if (goal) {
    const left = goal.kcalTarget - totals.kcal;
    lines.push('');
    lines.push(
      left >= 0
        ? `Норма ${goal.kcalTarget} ккал · осталось ${left}`
        : `Норма ${goal.kcalTarget} ккал · перебор ${Math.abs(left)}`,
    );
  }

  await ctx.reply(lines.join('\n'), {
    parse_mode: 'HTML',
    reply_markup: appKeyboard(),
  });
});

/* ───────────────────────── Разбор фотографии ───────────────────────── */

bot.on('message:photo', async (ctx) => {
  const user = await resolveUser(ctx);
  if (!user) return;

  const status = await ctx.reply('Разбираю фотографию…');

  try {
    // Массив размеров отсортирован по возрастанию — берём самый крупный:
    // на мелком превью не разглядеть ни состав, ни масштаб.
    const photo = ctx.message.photo.at(-1);
    if (!photo) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        status.message_id,
        'Не удалось получить изображение, попробуйте ещё раз.',
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

  const status = await ctx.reply('Считаю…');

  try {
    await handleRecognition(ctx, user, status.message_id, {
      text: ctx.message.text,
      source: 'text',
      rawInput: ctx.message.text,
    });
  } catch (error) {
    await reportFailure(ctx, status.message_id, error);
  }
});

/* ────────────────────── Подтверждение и отмена ─────────────────────── */

bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
  const user = await resolveUser(ctx);
  if (!user) return;

  const entryId = ctx.match[1];
  const ok = await confirmEntry(entryId, user.id);

  if (!ok) {
    await ctx.answerCallbackQuery({ text: 'Запись не найдена' });
    return;
  }

  const date = localDate(user.timezone);
  const [totals, goal] = await Promise.all([
    getDayTotals(user.id, date),
    getActiveGoal(user.id),
  ]);

  const tail = goal
    ? `\n\nЗа день: ${totals.kcal} из ${goal.kcalTarget} ккал`
    : `\n\nЗа день: ${totals.kcal} ккал`;

  await ctx.answerCallbackQuery({ text: 'Сохранено' });
  await ctx.editMessageText(
    `${ctx.callbackQuery.message?.text ?? 'Записано'}${tail}`,
    { parse_mode: 'HTML' },
  );
});

bot.callbackQuery(/^discard:(.+)$/, async (ctx) => {
  const user = await resolveUser(ctx);
  if (!user) return;

  await discardEntry(ctx.match[1], user.id);
  await ctx.answerCallbackQuery({ text: 'Отменено' });
  await ctx.editMessageText('Запись отменена.');
});

/* ─────────────────────── Общая логика разбора ──────────────────────── */

interface RecognitionRequest {
  imageBase64?: string;
  imageMediaType?: ImageMediaType;
  text?: string;
  photoRef?: string;
  source: 'photo' | 'text';
  rawInput?: string;
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
    await ctx.api.editMessageText(chatId, statusMessageId, outcome.message);
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
    aiModel: outcome.meta.model,
    aiLatencyMs: outcome.meta.latencyMs,
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
  });

  await ctx.api.editMessageText(chatId, statusMessageId, summary, {
    parse_mode: 'HTML',
    reply_markup: confirmKeyboard(entryId),
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
    await ctx.reply('Доступ к боту закрыт.');
    return null;
  }

  return user;
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
      'Не получилось разобрать. Попробуйте ещё раз через минуту.',
    );
  } catch {
    // Сообщение могли удалить, пока шёл разбор — это не повод падать
  }
}

bot.catch((err) => {
  console.error(`Ошибка в обработчике апдейта ${err.ctx.update.update_id}:`, err.error);
});

export { escapeHtml };
