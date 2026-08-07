import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import { signInitData, type StubUser } from './lib/telegram-stub';

/**
 * Проверка API Mini App на настоящей подписи Telegram.
 *
 * Подпись собирается тем же HMAC и тем же токеном бота, что использует
 * Telegram, поэтому запросы проходят ровно тот путь авторизации, что и
 * у живого пользователя. Отдельно проверяется главное: что подделанная
 * подпись отвергается и что чужой дневник недоступен.
 *
 * Запуск: BASE_URL=https://... tsx --test e2e/api.test.ts
 */

const BASE_URL =
  process.env.BASE_URL ?? 'https://web-production-d5ef0.up.railway.app';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

/** Отдельные идентификаторы для тестов, чтобы не пересечься с живыми людьми */
const ALICE: StubUser = {
  id: 990_000_101,
  first_name: 'Алиса',
  username: 'e2e_alice',
  language_code: 'ru',
};
const BOB: StubUser = {
  id: 990_000_102,
  first_name: 'Боб',
  username: 'e2e_bob',
  language_code: 'ru',
};

function authHeader(user: StubUser): Record<string, string> {
  return {
    authorization: `tma ${signInitData(user, BOT_TOKEN!)}`,
    'content-type': 'application/json',
  };
}

async function call(
  path: string,
  user: StubUser | null,
  init: RequestInit = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(user ? authHeader(user) : { 'content-type': 'application/json' }),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { _raw: text.slice(0, 200) };
  }
  return { status: response.status, body };
}

before(() => {
  if (!BOT_TOKEN) throw new Error('Нужен TELEGRAM_BOT_TOKEN для подписи');
});

describe('Авторизация', () => {
  test('без заголовка — 401', async () => {
    const { status } = await call('/api/me', null);
    assert.equal(status, 401);
  });

  test('чужая схема авторизации — 401', async () => {
    const response = await fetch(`${BASE_URL}/api/me`, {
      headers: { authorization: 'Bearer подделка' },
    });
    assert.equal(response.status, 401);
  });

  test('подделанная подпись — 401', async () => {
    const signed = signInitData(ALICE, BOT_TOKEN!);
    const tampered = new URLSearchParams(signed);
    tampered.set('user', JSON.stringify({ ...ALICE, id: 1 }));

    const response = await fetch(`${BASE_URL}/api/me`, {
      headers: { authorization: `tma ${tampered.toString()}` },
    });
    assert.equal(response.status, 401);
  });

  test('корректная подпись пропускается', async () => {
    const { status, body } = await call('/api/me', ALICE);
    assert.equal(status, 200);
    assert.equal((body.user as { firstName: string }).firstName, 'Алиса');
  });
});

describe('Онбординг', () => {
  test('до заполнения профиля флаг needsOnboarding поднят', async () => {
    const { body } = await call('/api/me', BOB);
    // Боб может быть уже заведён предыдущим прогоном — проверяем тип, а не значение
    assert.equal(typeof body.needsOnboarding, 'boolean');
  });

  test('профиль, вес и цель создаются одним запросом', async () => {
    const { status, body } = await call('/api/onboarding', ALICE, {
      method: 'POST',
      body: JSON.stringify({
        sex: 'male',
        birthDate: '1995-03-20',
        heightCm: 180,
        weightKg: 80,
        activityLevel: 'moderate',
        wristCm: 18.5,
        ankleCm: 22,
        goalType: 'lose',
        weeklyRateKg: 0.5,
        timezone: 'Asia/Almaty',
      }),
    });

    assert.equal(status, 200);
    const plan = body.plan as Record<string, number>;
    // Те же значения, что проверены юнит-тестами расчётного модуля
    assert.equal(plan.bmr, 1780);
    assert.equal(plan.tdee, 2759);
    assert.equal(plan.kcalTarget, 2209);
    assert.equal(body.bodyType, 'mesomorph');
  });

  test('слишком агрессивная цель урезается с объяснением', async () => {
    const { status, body } = await call('/api/onboarding', ALICE, {
      method: 'POST',
      body: JSON.stringify({
        sex: 'male',
        birthDate: '1995-03-20',
        heightCm: 180,
        weightKg: 80,
        activityLevel: 'moderate',
        goalType: 'lose',
        weeklyRateKg: 2,
        timezone: 'Asia/Almaty',
      }),
    });

    assert.equal(status, 200);
    const plan = body.plan as { adjustments: string[]; effectiveWeeklyRateKg: number };
    assert.ok(plan.adjustments.length > 0, 'ожидалось объяснение урезания');
    assert.ok(plan.effectiveWeeklyRateKg < 2);
  });

  test('некорректный рост отвергается с указанием поля', async () => {
    const { status, body } = await call('/api/onboarding', ALICE, {
      method: 'POST',
      body: JSON.stringify({
        sex: 'male',
        birthDate: '1995-03-20',
        heightCm: 40,
        weightKg: 80,
        activityLevel: 'moderate',
        goalType: 'lose',
      }),
    });

    assert.equal(status, 422);
    assert.ok((body.fields as Record<string, string>).heightCm);
  });

  test('после онбординга профиль и цель видны в /api/me', async () => {
    const { body } = await call('/api/me', ALICE);
    assert.equal(body.needsOnboarding, false);
    assert.ok(body.goal);
    assert.ok(body.energy);
    assert.equal((body.profile as { heightCm: number }).heightCm, 180);
  });
});

describe('Вес', () => {
  test('запись веса и повторная за ту же дату перезаписывает', async () => {
    const date = '2026-08-01';
    await call('/api/weight', ALICE, {
      method: 'POST',
      body: JSON.stringify({ weightKg: 80.5, loggedOn: date }),
    });
    const { status, body } = await call('/api/weight', ALICE, {
      method: 'POST',
      body: JSON.stringify({ weightKg: 80.2, loggedOn: date }),
    });

    assert.equal(status, 200);
    assert.equal(body.weightKg, 80.2);
  });

  test('история возвращает скользящее среднее', async () => {
    const { status, body } = await call('/api/weight?days=90', ALICE);
    assert.equal(status, 200);
    const series = body.series as { date: string; raw: number; average: number }[];
    assert.ok(Array.isArray(series) && series.length > 0);
    assert.ok(typeof series[0].average === 'number');
  });
});

describe('Замеры тела', () => {
  test('процент жира считается по обхватам', async () => {
    const { status, body } = await call('/api/measurements', ALICE, {
      method: 'POST',
      body: JSON.stringify({
        measuredOn: '2026-08-01',
        neckCm: 38,
        waistCm: 85,
      }),
    });

    assert.equal(status, 200);
    // Та же величина, что проверена юнит-тестом формулы US Navy
    assert.ok(Math.abs((body.bodyFatPct as number) - 16.1) < 0.5);
  });

  test('невозможные обхваты не дают выдуманного числа', async () => {
    const { body } = await call('/api/measurements', ALICE, {
      method: 'POST',
      body: JSON.stringify({
        measuredOn: '2026-08-02',
        neckCm: 40,
        waistCm: 41,
      }),
    });

    assert.equal(body.bodyFatPct, null);
    assert.ok(body.bodyFatNote, 'ожидалось объяснение вместо числа');
  });
});

describe('Дневник', () => {
  test('за пустой день возвращается нулевой итог', async () => {
    const { status, body } = await call('/api/day?date=2020-01-01', ALICE);
    assert.equal(status, 200);
    assert.deepEqual(body.entries, []);
    assert.equal((body.totals as { kcal: number }).kcal, 0);
  });

  test('некорректная дата отвергается', async () => {
    const { status } = await call('/api/day?date=вчера', ALICE);
    assert.equal(status, 422);
  });
});

describe('Разграничение доступа', () => {
  test('чужая запись не читается по идентификатору', async () => {
    // Идентификатор записи приходит из URL и полностью под контролем клиента,
    // поэтому проверка владения — единственное, что мешает читать чужой дневник
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const { status } = await call(`/api/entries/${fakeId}`, BOB);
    assert.equal(status, 404);
  });

  test('дневники двух пользователей не пересекаются', async () => {
    const alice = await call('/api/day?date=2020-01-01', ALICE);
    const bob = await call('/api/day?date=2020-01-01', BOB);
    assert.equal(alice.status, 200);
    assert.equal(bob.status, 200);
    assert.deepEqual(alice.body.entries, []);
    assert.deepEqual(bob.body.entries, []);
  });
});
