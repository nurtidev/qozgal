import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Накат миграций при деплое.
 *
 * Использует мигратор из drizzle-orm, а не drizzle-kit: drizzle-kit —
 * dev-зависимость и на продакшене может отсутствовать после prune.
 * Мигратор же живёт в основном пакете, который нужен приложению в любом случае.
 *
 * Операция идемпотентна: drizzle ведёт таблицу применённых миграций и
 * пропускает те, что уже накатаны. Поэтому команду можно безопасно ставить
 * в старт сервиса — при каждом рестарте она просто ничего не сделает.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL не задан');
  }

  // Отдельное соединение с max: 1 — мигратор выполняет DDL последовательно,
  // пул здесь не нужен и мешал бы блокировкам.
  const client = postgres(url, { max: 1, connect_timeout: 30 });

  try {
    console.log('Накатываю миграции…');
    await migrate(drizzle(client), { migrationsFolder: './drizzle' });
    console.log('Миграции применены.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Миграция не удалась:', error);
  process.exit(1);
});
