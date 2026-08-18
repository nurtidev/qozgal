#!/usr/bin/env node
// Нажать inline-кнопку под сообщением бота от лица владельца.
//
//   node tools/telegram/click.mjs @qozgalkzbot 718517 Сохранить
//
// Без этого не проверить ни подтверждение записи, ни отмену, ни отключение
// напоминаний — то есть половину поведения бота.
import { Api } from 'telegram';
import { connect, resolvePeer } from './lib.mjs';

const [, , target, msgId, needle] = process.argv;
if (!target || !msgId || !needle) {
  console.error('usage: node tools/telegram/click.mjs <@username|chat_id> <msg_id> <часть текста кнопки>');
  process.exit(2);
}

const client = await connect();
try {
  const peer = await resolvePeer(client, target);
  const [message] = await client.getMessages(peer, { ids: [Number(msgId)] });

  if (!message?.replyMarkup) {
    console.error('под сообщением нет кнопок');
    process.exit(1);
  }

  let data = null;
  for (const row of message.replyMarkup.rows ?? []) {
    for (const button of row.buttons ?? []) {
      if ((button.text || '').toLowerCase().includes(needle.toLowerCase()) && button.data) {
        data = button.data;
      }
    }
  }

  if (!data) {
    console.error(`кнопка «${needle}» не найдена`);
    process.exit(1);
  }

  const result = await client.invoke(
    new Api.messages.GetBotCallbackAnswer({
      peer,
      msgId: Number(msgId),
      data,
    }),
  );

  console.log(`ответ бота: ${result.message || '(без текста)'}`);
} finally {
  await client.disconnect();
}
