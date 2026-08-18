#!/usr/bin/env node
// Скачать вложение сообщения — например, фотографию еды из переписки,
// чтобы прогнать её через разбор заново после правок.
//
//   node tools/telegram/download.mjs @qozgalkzbot 718291 ./out
//
// Резолв по @username поддержан намеренно: штатный скрипт в рабочем
// workspace умел только числовой id и падал на пустом кэше entity.
import fs from 'node:fs';
import path from 'node:path';
import { connect, resolvePeer } from './lib.mjs';

const [, , target, msgId, outDirArg] = process.argv;
if (!target || !msgId) {
  console.error('usage: node tools/telegram/download.mjs <@username|chat_id> <msg_id> [каталог]');
  process.exit(2);
}

const outDir = outDirArg || '.';
fs.mkdirSync(outDir, { recursive: true });

const client = await connect();
try {
  const peer = await resolvePeer(client, target);
  const [message] = await client.getMessages(peer, { ids: [Number(msgId)] });

  if (!message) throw new Error(`сообщение ${msgId} не найдено`);
  if (!message.media) throw new Error(`в сообщении ${msgId} нет вложения`);

  const buffer = await client.downloadMedia(message);
  // Расширение по первым байтам: JPEG и PNG различаются надёжнее, чем
  // по mime-type, который у документов Telegram бывает пустым
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
  const png = buffer[0] === 0x89 && buffer[1] === 0x50;
  const ext = jpeg ? 'jpg' : png ? 'png' : 'bin';

  const file = path.join(outDir, `msg-${msgId}.${ext}`);
  fs.writeFileSync(file, buffer);
  console.log(`скачано: ${file} (${buffer.length} байт)`);
} finally {
  await client.disconnect();
}
