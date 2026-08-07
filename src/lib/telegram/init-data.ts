import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/* ─────────────────────────── Разбор полей ──────────────────────────── */

const telegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
  is_premium: z.boolean().optional(),
  photo_url: z.string().url().optional(),
  allows_write_to_pm: z.boolean().optional(),
});

export type TelegramUser = z.infer<typeof telegramUserSchema>;

export interface InitData {
  user: TelegramUser;
  authDate: Date;
  queryId?: string;
  startParam?: string;
  chatType?: string;
  chatInstance?: string;
}

export type ValidationFailure =
  | 'missing_hash'
  | 'bad_signature'
  | 'expired'
  | 'missing_user'
  | 'malformed_user';

export type ValidationResult =
  | { ok: true; data: InitData }
  | { ok: false; reason: ValidationFailure };

/* ───────────────────────────── Проверка ────────────────────────────── */

/** Сколько живёт initData. Telegram обновляет его при открытии Mini App. */
const DEFAULT_MAX_AGE_SEC = 24 * 60 * 60;

/**
 * Ключ подписи выводится из токена бота, а не является им напрямую.
 *
 * Важно не перепутать порядок аргументов: для Mini Apps ключом HMAC служит
 * строка "WebAppData", а сообщением — токен бота. У Telegram Login Widget
 * схема обратная (ключ — SHA256 от токена), и перепутанные местами аргументы
 * дадут стабильно неверную подпись.
 */
function deriveSecretKey(botToken: string): Buffer {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

function buildDataCheckString(
  params: URLSearchParams,
  excludeSignature: boolean,
): string {
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    if (excludeSignature && key === 'signature') continue;
    pairs.push(`${key}=${value}`);
  }
  return pairs.sort().join('\n');
}

/** Сравнение, не зависящее от позиции первого различающегося байта */
function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Проверяет подпись initData и возвращает данные пользователя.
 *
 * Это единственная точка, где мы решаем, кто перед нами. Всё, что приходит
 * от клиента помимо подписанной строки — включая telegram_id в теле запроса —
 * доверять нельзя.
 *
 * @param raw      строка initData как её отдал Telegram (query-string)
 * @param botToken токен бота, которому принадлежит Mini App
 */
export function validateInitData(
  raw: string,
  botToken: string,
  maxAgeSec: number = DEFAULT_MAX_AGE_SEC,
): ValidationResult {
  const params = new URLSearchParams(raw);

  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'missing_hash' };

  const secretKey = deriveSecretKey(botToken);

  // Поле signature появилось позже основной схемы и предназначено для
  // сторонней проверки по Ed25519. Разные версии клиентов Telegram
  // по-разному учитывают его в строке для HMAC, поэтому проверяем оба
  // варианта. Безопасность от этого не страдает: обе строки подписаны
  // тем же секретом, подделать любую из них без токена бота невозможно.
  const candidates = [
    buildDataCheckString(params, false),
    buildDataCheckString(params, true),
  ];

  const matched = candidates.some((dcs) => {
    const computed = createHmac('sha256', secretKey)
      .update(dcs)
      .digest('hex');
    return safeEquals(computed, hash);
  });

  if (!matched) return { ok: false, reason: 'bad_signature' };

  // Подпись верна — но перехваченный initData можно переиспользовать,
  // поэтому ограничиваем срок жизни.
  const authDateRaw = params.get('auth_date');
  const authDateSec = Number(authDateRaw);
  if (!authDateRaw || !Number.isFinite(authDateSec)) {
    return { ok: false, reason: 'expired' };
  }

  const ageSec = Math.floor(Date.now() / 1000) - authDateSec;
  if (ageSec > maxAgeSec) return { ok: false, reason: 'expired' };

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'missing_user' };

  let parsedUser: unknown;
  try {
    parsedUser = JSON.parse(userRaw);
  } catch {
    return { ok: false, reason: 'malformed_user' };
  }

  const user = telegramUserSchema.safeParse(parsedUser);
  if (!user.success) return { ok: false, reason: 'malformed_user' };

  return {
    ok: true,
    data: {
      user: user.data,
      authDate: new Date(authDateSec * 1000),
      queryId: params.get('query_id') ?? undefined,
      startParam: params.get('start_param') ?? undefined,
      chatType: params.get('chat_type') ?? undefined,
      chatInstance: params.get('chat_instance') ?? undefined,
    },
  };
}

/* ───────────────────── Вспомогательное для API ─────────────────────── */

/**
 * Достаёт initData из заголовка Authorization.
 * Формат — `tma <initDataRaw>`, соглашение экосистемы Telegram Mini Apps.
 */
export function extractInitData(header: string | null): string | null {
  if (!header) return null;
  const [scheme, ...rest] = header.split(' ');
  if (scheme.toLowerCase() !== 'tma' || rest.length === 0) return null;
  const value = rest.join(' ').trim();
  return value.length > 0 ? value : null;
}

/** Понятное пользователю объяснение отказа */
export const FAILURE_MESSAGES: Record<ValidationFailure, string> = {
  missing_hash: 'Запрос не подписан Telegram',
  bad_signature: 'Подпись Telegram недействительна',
  expired: 'Сессия устарела, переоткройте приложение',
  missing_user: 'Telegram не передал данные пользователя',
  malformed_user: 'Данные пользователя повреждены',
};

/**
 * Определяет язык интерфейса по данным Telegram.
 * Поддерживаем русский и казахский; всё остальное — русский по умолчанию.
 */
export function resolveLocale(languageCode?: string): 'ru' | 'kk' {
  return languageCode?.toLowerCase().startsWith('kk') ? 'kk' : 'ru';
}
