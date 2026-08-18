#!/usr/bin/env node
// Прочитать переписку с ботом: текст, кнопки и разметку.
//
//   node tools/telegram/read.mjs @qozgalkzbot [сколько]
//
// Кнопки печатаются отдельно: без них не видно, что бот вообще предложил
// сделать, а половина сценариев в боте — именно кнопки.
import { connect, resolvePeer } from './lib.mjs';

const [, , target, limitArg] = process.argv;
if (!target) {
  console.error('usage: node tools/telegram/read.mjs <@username|chat_id> [limit]');
  process.exit(2);
}

const client = await connect();
try {
  const peer = await resolvePeer(client, target);
  const messages = await client.getMessages(peer, {
    limit: Number(limitArg) || 5,
  });

  for (const message of [...messages].reverse()) {
    const who = message.out ? 'я' : 'бот';
    const buttons = (message.replyMarkup?.rows ?? [])
      .flatMap((row) => row.buttons ?? [])
      .map((button) => button.text)
      .join(' | ');

    console.log(
      `--- msg ${message.id} (${who})${buttons ? ` [кнопки: ${buttons}]` : ''}`,
    );
    console.log(message.message || '(без текста)');
  }
} finally {
  await client.disconnect();
}
