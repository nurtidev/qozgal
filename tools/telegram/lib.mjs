// Подключение к Telegram от лица владельца аккаунта (userbot).
//
// Зачем это в проекте: бот — единственный интерфейс к разбору еды, и половина
// его поведения (кнопки под карточкой, закреплённая сводка, утренний вопрос
// про вес) проверяется только в живом чате. Заглушка в браузере отвечает
// за Mini App, а здесь проверяется сам бот.
//
// Метод перенесён из рабочего workspace, чтобы проверки не зависели от чужой
// папки, которая может переехать, — так один раз и случилось посреди работы.
//
// 🔴 Сессия — это полный доступ к аккаунту, и репозиторий публичный. Поэтому
// креды остаются вне проекта: путь берётся из TELEGRAM_CREDS_DIR, по умолчанию
// указывает на рабочий workspace. Копировать session.txt внутрь репозитория
// нельзя, .gitignore это подстраховывает, но решает не он.
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_CREDS = path.join(
  os.homedir(),
  'Documents',
  'agro_all',
  'creds',
  'telegram',
);

export const CREDS = process.env.TELEGRAM_CREDS_DIR || DEFAULT_CREDS;

/** Читает api_id и api_hash из файла env рядом с сессией */
function loadEnv() {
  const file = path.join(CREDS, 'env');
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] ||= rest.join('=').trim();
  }
}

export async function connect() {
  loadEnv();

  const apiId = Number(process.env.TG_API_ID || process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TG_API_HASH || process.env.TELEGRAM_API_HASH;
  const sessionFile = path.join(CREDS, 'session.txt');

  if (!apiId || !apiHash) {
    console.error(
      `нет TG_API_ID/TG_API_HASH — положите их в ${path.join(CREDS, 'env')}`,
    );
    process.exit(1);
  }

  if (!fs.existsSync(sessionFile)) {
    console.error(
      `нет session.txt в ${CREDS} — войдите в аккаунт в рабочем workspace ` +
        `или укажите TELEGRAM_CREDS_DIR`,
    );
    process.exit(1);
  }

  const client = new TelegramClient(
    new StringSession(fs.readFileSync(sessionFile, 'utf8').trim()),
    apiId,
    apiHash,
    { connectionRetries: 5, useWSS: false },
  );

  await client.connect();

  if (!(await client.isUserAuthorized())) {
    console.error('сессия недействительна — нужен повторный вход');
    process.exit(1);
  }

  return client;
}

/**
 * Собеседник по @username или числовому id.
 *
 * У свежей сессии кэш entity пуст, и getEntity по голому числовому id падает
 * с «Could not find the input entity» — на этом в прошлый раз спотыкались
 * штатные скрипты. Поэтому: @username резолвится напрямую, число — через
 * список диалогов.
 */
export async function resolvePeer(client, id) {
  if (String(id).startsWith('@')) return client.getEntity(String(id));

  try {
    return await client.getEntity(Number(id));
  } catch {
    const dialogs = await client.getDialogs({ limit: 300 });
    const hit = dialogs.find((d) => String(d.id) === String(id));
    if (!hit) throw new Error(`чат ${id} не найден среди диалогов`);
    return hit.entity;
  }
}

/** Текст из stdin целиком: переносы строк и кавычки не надо экранировать */
export async function readStdin() {
  if (process.stdin.isTTY) return '';

  return new Promise((resolve, reject) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (buffer += chunk));
    process.stdin.on('end', () => resolve(buffer.trim()));
    process.stdin.on('error', reject);
  });
}
