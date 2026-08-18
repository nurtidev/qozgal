#!/usr/bin/env node
// Отправить боту снимок — именно фотографией, а не документом.
//
//   node tools/telegram/send-photo.mjs @qozgalkzbot ./meal.jpg [--document] <<'EOF'
//   подпись, если нужна
//   EOF
//
// Штатный отправщик файлов в рабочем workspace ставит forceDocument: true,
// и снимок уходил документом. Для нас это разные пути в боте: у фотографии
// есть лестница размеров, из которой берётся вариант от 1000 px (дешевле
// вдвое по токенам), а документ уходит в модель как есть. Проверять надо
// тот путь, которым пользуются люди, поэтому по умолчанию — фото.
import fs from 'node:fs';
import { connect, resolvePeer, readStdin } from './lib.mjs';

const [, , target, filePath, ...rest] = process.argv;
if (!target || !filePath) {
  console.error('usage: node tools/telegram/send-photo.mjs <@username|chat_id> <файл> [--document]');
  process.exit(2);
}

if (!fs.existsSync(filePath)) {
  console.error(`файл не найден: ${filePath}`);
  process.exit(2);
}

const asDocument = rest.includes('--document');
const caption = await readStdin();

const client = await connect();
try {
  const peer = await resolvePeer(client, target);
  const message = await client.sendFile(peer, {
    file: filePath,
    caption: caption || undefined,
    forceDocument: asDocument,
  });
  console.log(
    `отправлено ${asDocument ? 'документом' : 'фотографией'}: msg ${message.id} → ${target}`,
  );
} finally {
  await client.disconnect();
}
