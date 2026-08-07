import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  validateInitData,
  extractInitData,
  resolveLocale,
} from './init-data';

const BOT_TOKEN = '1234567890:AAFakeTokenForTestsOnly_NotARealBotToken';
const OTHER_TOKEN = '9999999999:BBDifferentTokenEntirely_AlsoNotReal____';

/**
 * Подписывает набор полей так же, как это делает Telegram, — чтобы тесты
 * проверяли реальную схему, а не наше же представление о ней.
 */
function signInitData(
  fields: Record<string, string>,
  botToken = BOT_TOKEN,
  opts: { signatureInCheckString?: boolean } = {},
): string {
  const { signatureInCheckString = true } = opts;

  const dataCheckString = Object.entries(fields)
    .filter(([k]) => k !== 'hash')
    .filter(([k]) => signatureInCheckString || k !== 'signature')
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const hash = createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

const USER = {
  id: 123456789,
  first_name: 'Нұртілек',
  username: 'nurtidev',
  language_code: 'kk',
};

function makeFields(overrides: Record<string, string> = {}) {
  return {
    user: JSON.stringify(USER),
    auth_date: String(nowSec()),
    query_id: 'AAF_test_query_id',
    ...overrides,
  };
}

describe('Проверка подписи initData', () => {
  test('корректно подписанные данные принимаются', () => {
    const raw = signInitData(makeFields());
    const result = validateInitData(raw, BOT_TOKEN);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.user.id, 123456789);
    assert.equal(result.data.user.username, 'nurtidev');
    assert.equal(result.data.queryId, 'AAF_test_query_id');
  });

  test('подмена telegram_id после подписи отклоняется', () => {
    const raw = signInitData(makeFields());

    // Классическая атака: подписанный initData есть, но пользователь
    // подменяет в нём свой id на чужой, чтобы прочитать чужой дневник.
    const params = new URLSearchParams(raw);
    params.set('user', JSON.stringify({ ...USER, id: 987654321 }));

    const result = validateInitData(params.toString(), BOT_TOKEN);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'bad_signature');
  });

  test('данные, подписанные другим ботом, отклоняются', () => {
    const raw = signInitData(makeFields(), OTHER_TOKEN);
    const result = validateInitData(raw, BOT_TOKEN);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'bad_signature');
  });

  test('без поля hash данные отклоняются', () => {
    const params = new URLSearchParams(makeFields());
    const result = validateInitData(params.toString(), BOT_TOKEN);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'missing_hash');
  });

  test('пустая строка отклоняется', () => {
    const result = validateInitData('', BOT_TOKEN);
    assert.equal(result.ok, false);
  });
});

describe('Срок жизни initData', () => {
  test('просроченные данные отклоняются даже при верной подписи', () => {
    const twoDaysAgo = String(nowSec() - 2 * 24 * 60 * 60);
    const raw = signInitData(makeFields({ auth_date: twoDaysAgo }));

    const result = validateInitData(raw, BOT_TOKEN);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'expired');
  });

  test('свежие данные в пределах окна принимаются', () => {
    const hourAgo = String(nowSec() - 3600);
    const raw = signInitData(makeFields({ auth_date: hourAgo }));

    assert.equal(validateInitData(raw, BOT_TOKEN).ok, true);
  });

  test('окно жизни настраивается', () => {
    const tenMinAgo = String(nowSec() - 600);
    const raw = signInitData(makeFields({ auth_date: tenMinAgo }));

    assert.equal(validateInitData(raw, BOT_TOKEN, 300).ok, false);
    assert.equal(validateInitData(raw, BOT_TOKEN, 900).ok, true);
  });
});

describe('Поле signature', () => {
  // Разные версии клиентов Telegram по-разному учитывают signature
  // в строке для HMAC. Принимаем оба варианта.
  const fields = makeFields({ signature: 'Ed25519SignaturePlaceholder' });

  test('вариант с signature внутри строки подписи', () => {
    const raw = signInitData(fields, BOT_TOKEN, {
      signatureInCheckString: true,
    });
    assert.equal(validateInitData(raw, BOT_TOKEN).ok, true);
  });

  test('вариант с signature вне строки подписи', () => {
    const raw = signInitData(fields, BOT_TOKEN, {
      signatureInCheckString: false,
    });
    assert.equal(validateInitData(raw, BOT_TOKEN).ok, true);
  });
});

describe('Разбор данных пользователя', () => {
  test('битый JSON в поле user отклоняется', () => {
    const raw = signInitData(makeFields({ user: '{не json' }));
    const result = validateInitData(raw, BOT_TOKEN);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'malformed_user');
  });

  test('отсутствие поля user отклоняется', () => {
    const raw = signInitData({
      auth_date: String(nowSec()),
      query_id: 'AAF_test',
    });
    const result = validateInitData(raw, BOT_TOKEN);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'missing_user');
  });

  test('user без обязательного id отклоняется', () => {
    const raw = signInitData(
      makeFields({ user: JSON.stringify({ first_name: 'Аноним' }) }),
    );
    const result = validateInitData(raw, BOT_TOKEN);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.reason, 'malformed_user');
  });

  test('кириллица и казахские буквы в имени не ломают подпись', () => {
    const raw = signInitData(
      makeFields({
        user: JSON.stringify({ id: 1, first_name: 'Әсем', last_name: 'Оспанқызы' }),
      }),
    );
    const result = validateInitData(raw, BOT_TOKEN);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.user.first_name, 'Әсем');
  });
});

describe('Заголовок Authorization', () => {
  test('извлекает initData из схемы tma', () => {
    assert.equal(extractInitData('tma user=%7B%7D&hash=abc'), 'user=%7B%7D&hash=abc');
  });

  test('регистр схемы не важен', () => {
    assert.equal(extractInitData('TMA payload'), 'payload');
  });

  test('чужая схема игнорируется', () => {
    assert.equal(extractInitData('Bearer sometoken'), null);
  });

  test('пустой заголовок и схема без значения дают null', () => {
    assert.equal(extractInitData(null), null);
    assert.equal(extractInitData('tma'), null);
    assert.equal(extractInitData('tma   '), null);
  });
});

describe('Определение языка', () => {
  test('казахский код языка даёт kk', () => {
    assert.equal(resolveLocale('kk'), 'kk');
    assert.equal(resolveLocale('kk-KZ'), 'kk');
  });

  test('остальные языки сводятся к русскому', () => {
    assert.equal(resolveLocale('ru'), 'ru');
    assert.equal(resolveLocale('en'), 'ru');
    assert.equal(resolveLocale(undefined), 'ru');
  });
});
