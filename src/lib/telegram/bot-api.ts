import { env } from '@/env';

/**
 * Тонкий клиент Bot API для веб-части.
 *
 * Веб знает токен бота — им же проверяется подпись initData, — поэтому
 * отдельного канала до Telegram заводить не нужно. grammY сюда не тащим:
 * из приложения нужен ровно один вызов.
 */

/**
 * Гасит кнопки под сообщением бота.
 *
 * Подтвердив разбор в Mini App, человек возвращается в чат, где под
 * карточкой всё ещё висит «✕ Отмена» — и один тап отправляет уже
 * сохранённую запись в отменённые. Кнопки должны исчезнуть вместе
 * с поводом их нажимать.
 *
 * Ошибки только логируются: сообщение могли удалить, оно могло устареть
 * (Telegram не даёт править старше 48 часов) или кнопок уже нет. Ни один
 * из этих случаев не повод отказать в сохранении записи.
 */
export async function clearInlineKeyboard(
  chatId: number,
  messageId: number,
): Promise<void> {
  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageReplyMarkup`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [] },
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      console.warn('Кнопки под сообщением бота не погашены:', response.status, detail);
    }
  } catch (error) {
    console.warn('Кнопки под сообщением бота не погашены:', error);
  }
}
