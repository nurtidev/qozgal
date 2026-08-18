#!/usr/bin/env node
// Отправить боту сообщение от лица владельца аккаунта.
//
//   node tools/telegram/send.mjs @qozgalkzbot <<'EOF'
//   куриные наггетсы 230 г
//   EOF
//
// Правило владельца: ничего наружу без явного «отправляй». Скрипт этого
// не проверяет — следит тот, кто его запускает.
import { connect, resolvePeer, readStdin } from './lib.mjs';

const [, , target] = process.argv;
if (!target) {
  console.error('usage: node tools/telegram/send.mjs <@username|chat_id> < текст на stdin');
  process.exit(2);
}

const text = await readStdin();
if (!text) {
  console.error('пустой текст: сообщение читается из stdin');
  process.exit(2);
}

const client = await connect();
try {
  const peer = await resolvePeer(client, target);
  const message = await client.sendMessage(peer, { message: text });
  console.log(`отправлено: msg ${message.id} → ${target}`);
} finally {
  await client.disconnect();
}
