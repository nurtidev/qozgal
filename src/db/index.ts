import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * В dev-режиме Next.js перезагружает модули при каждом изменении файла.
 * Без кеша в globalThis это открывало бы новый пул соединений на каждую
 * пересборку, и Postgres быстро упёрся бы в max_connections.
 */
const globalForDb = globalThis as unknown as {
  sqlClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.sqlClient ??
  postgres(process.env.DATABASE_URL!, {
    max: process.env.NODE_ENV === 'production' ? 10 : 3,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.sqlClient = client;
}

export const db = drizzle(client, { schema });
export { schema };
export type Db = typeof db;
