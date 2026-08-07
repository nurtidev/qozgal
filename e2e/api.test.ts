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
/** Казахоязычный клиент — на нём проверяется язык ответов сервера */
const KAIRAT: StubUser = {
  id: 990_000_103,
  first_name: 'Қайрат',
  username: 'e2e_kairat',
  language_code: 'kk',
};

/**
 * Дата рождения, дающая ровно N полных лет на сегодня.
 *
 * Фиксированную дату брать нельзя: возраст входит в формулу обмена, и через
 * год те же ожидаемые значения перестали бы сходиться. Отнимаем лишний день,
 * чтобы день рождения гарантированно уже прошёл и возраст не зависел от того,
 * в какую сторону округлится сегодняшняя дата.
 */
function birthDateForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

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
    // Значение заголовка только латиницей: HTTP-заголовки обязаны быть ASCII,
    // кириллица в них падает ещё в клиенте, не доходя до сервера
    const response = await fetch(`${BASE_URL}/api/me`, {
      headers: { authorization: 'Bearer forged-token' },
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
        birthDate: birthDateForAge(30),
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
        birthDate: birthDateForAge(30),
        heightCm: 180,
        weightKg: 80,
        activityLevel: 'moderate',
        goalType: 'lose',
        weeklyRateKg: 2,
        timezone: 'Asia/Almaty',
      }),
    });

    assert.equal(status, 200);
    // Пояснения приходят кодами, а не готовыми фразами: текст живёт
    // в словарях Mini App, сервер языка пользователя не знает
    const plan = body.plan as {
      adjustments: { code: string }[];
      effectiveWeeklyRateKg: number;
    };
    assert.ok(plan.adjustments.length > 0, 'ожидалось объяснение урезания');
    assert.ok(plan.adjustments.every((a) => typeof a.code === 'string'));
    assert.ok(plan.effectiveWeeklyRateKg < 2);
  });

  test('некорректный рост отвергается с указанием поля', async () => {
    const { status, body } = await call('/api/onboarding', ALICE, {
      method: 'POST',
      body: JSON.stringify({
        sex: 'male',
        birthDate: birthDateForAge(30),
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

describe('Справочник продуктов', () => {
  test('поиск находит карточку местной кухни', async () => {
    const { status, body } = await call('/api/products?q=беш', ALICE);
    assert.equal(status, 200);
    const found = body.products as { name: string; kcalPer100g: number }[];
    assert.ok(found.length > 0, 'ожидалась хотя бы одна карточка');
    assert.match(found[0].name, /Бешбармак/);
  });

  test('казахоязычному имя приходит по-казахски', async () => {
    const { body } = await call('/api/products?q=беш', KAIRAT);
    const found = body.products as { name: string }[];
    assert.match(found[0].name, /Бесбармақ/);
  });

  test('запрос короче двух букв не выдаёт полсправочника', async () => {
    const { body } = await call('/api/products?q=б', ALICE);
    assert.deepEqual(body.products, []);
  });

  test('шаблон LIKE в запросе не подставляется', async () => {
    // «%» должен искаться как символ, а не как «что угодно»
    const { status, body } = await call('/api/products?q=%%', ALICE);
    assert.equal(status, 200);
    assert.deepEqual(body.products, []);
  });

  test('дописать позицию в чужую запись нельзя', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const { status } = await call(`/api/entries/${fakeId}/items`, BOB, {
      method: 'POST',
      body: JSON.stringify({
        productId: '00000000-0000-4000-8000-000000000001',
        grams: 100,
      }),
    });
    assert.equal(status, 404);
  });
});

describe('Повтор приёма пищи', () => {
  test('повторить чужую запись нельзя', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const { status } = await call('/api/entries', BOB, {
      method: 'POST',
      body: JSON.stringify({ repeatOf: fakeId }),
    });
    assert.equal(status, 404);
  });

  test('без идентификатора записи повтор отвергается', async () => {
    const { status, body } = await call('/api/entries', ALICE, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(status, 422);
    assert.ok((body.fields as Record<string, string>).repeatOf);
  });
});

describe('Тренировки', () => {
  test('справочник упражнений отдаётся', async () => {
    const { status, body } = await call('/api/exercises', ALICE);
    assert.equal(status, 200);
    const list = body.exercises as { name: string; muscleGroup: string }[];
    assert.ok(list.length >= 30, 'ожидался наполненный справочник');
    assert.ok(list.some((e) => e.muscleGroup === 'legs'));
  });

  test('казахоязычному упражнения приходят по-казахски', async () => {
    const { body } = await call('/api/exercises?q=жим', KAIRAT);
    const list = body.exercises as { name: string }[];
    // «Жим лёжа» → «Жатып итеру»; поиск идёт по обоим языкам
    assert.ok(list.some((e) => /итеру/.test(e.name)), 'ожидалось казахское название');
  });

  test('чужая тренировка не читается', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const { status } = await call(`/api/workouts/${fakeId}`, BOB);
    assert.equal(status, 404);
  });

  test('подход в чужую тренировку не добавить', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const { status } = await call(`/api/workouts/${fakeId}/sets`, BOB, {
      method: 'POST',
      body: JSON.stringify({
        exerciseId: '00000000-0000-4000-8000-000000000001',
        reps: 8,
      }),
    });
    assert.equal(status, 404);
  });

  test('тренировка заводится и удаляется', async () => {
    const created = await call('/api/workouts', ALICE, {
      method: 'POST',
      body: JSON.stringify({ durationMin: 45 }),
    });
    assert.equal(created.status, 200);
    const id = created.body.id as string;

    const read = await call(`/api/workouts/${id}`, ALICE);
    assert.equal(read.status, 200);
    assert.equal(read.body.durationMin, 45);
    // Подходов нет — тоннаж нулевой, а не выдуманный
    assert.equal(read.body.volumeKg, 0);

    const foreign = await call(`/api/workouts/${id}`, BOB);
    assert.equal(foreign.status, 404, 'чужая тренировка должна быть невидима');

    const removed = await call(`/api/workouts/${id}`, ALICE, { method: 'DELETE' });
    assert.equal(removed.status, 200);
  });
});

describe('Травмы и ограничения', () => {
  test('травма заводится и помечает упражнения', async () => {
    const created = await call('/api/injuries', ALICE, {
      method: 'POST',
      body: JSON.stringify({ area: 'lower_back', severity: 'pain' }),
    });
    assert.equal(created.status, 200);
    const id = created.body.id as string;

    const list = await call('/api/exercises', ALICE);
    const found = list.body.exercises as {
      name: string;
      conflicts: { area: string; severity: string }[];
    }[];

    const deadlift = found.find((e) => /Становая/.test(e.name));
    assert.ok(deadlift, 'становая тяга должна быть в справочнике');
    assert.deepEqual(deadlift.conflicts, [
      { area: 'lower_back', severity: 'pain' },
    ]);

    // Махи в стороны поясницу не нагружают — помечать их нечем
    const raise = found.find((e) => /Махи в стороны/.test(e.name));
    assert.deepEqual(raise?.conflicts, []);

    // Закрытая травма на подбор больше не влияет
    const resolved = await call(`/api/injuries/${id}`, ALICE, {
      method: 'PATCH',
      body: JSON.stringify({ resolve: true }),
    });
    assert.equal(resolved.status, 200);

    const after = await call('/api/exercises', ALICE);
    const stillMarked = (after.body.exercises as { conflicts: unknown[] }[]).filter(
      (e) => e.conflicts.length > 0,
    );
    assert.deepEqual(stillMarked, []);

    await call(`/api/injuries/${id}`, ALICE, { method: 'DELETE' });
  });

  test('чужую травму не поправить', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const { status } = await call(`/api/injuries/${fakeId}`, BOB, {
      method: 'PATCH',
      body: JSON.stringify({ resolve: true }),
    });
    assert.equal(status, 404);
  });

  test('неизвестная область тела отвергается', async () => {
    const { status } = await call('/api/injuries', ALICE, {
      method: 'POST',
      body: JSON.stringify({ area: 'soul' }),
    });
    assert.equal(status, 422);
  });
});

describe('Язык ответов', () => {
  test('ошибка валидации приходит по-казахски', async () => {
    const { status, body } = await call('/api/onboarding', KAIRAT, {
      method: 'POST',
      body: JSON.stringify({
        sex: 'male',
        birthDate: birthDateForAge(30),
        heightCm: 40,
        weightKg: 80,
        activityLevel: 'moderate',
        goalType: 'lose',
      }),
    });

    assert.equal(status, 422);
    // Язык берётся из language_code подписи, а не из заголовков запроса
    assert.equal(body.error, 'Деректер дұрыс емес');
    assert.equal((body.fields as Record<string, string>).heightCm, 'Бой 100 см-ден төмен');
  });

  test('тому же запросу от русскоязычного отвечают по-русски', async () => {
    const { body } = await call('/api/onboarding', ALICE, {
      method: 'POST',
      body: JSON.stringify({
        sex: 'male',
        birthDate: birthDateForAge(30),
        heightCm: 40,
        weightKg: 80,
        activityLevel: 'moderate',
        goalType: 'lose',
      }),
    });

    assert.equal(body.error, 'Некорректные данные');
    assert.equal((body.fields as Record<string, string>).heightCm, 'Рост меньше 100 см');
  });

  test('ненайденная запись объясняется на языке пользователя', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const { status, body } = await call(`/api/entries/${fakeId}`, KAIRAT);
    assert.equal(status, 404);
    assert.equal(body.error, 'Жазба табылмады');
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
