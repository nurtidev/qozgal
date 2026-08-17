import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { advise, overloaded, type ProgressionInput, type SessionLog } from './progression';

/**
 * Совет про вес человек выполнит, не проверяя: он для этого и нужен.
 * Поэтому проверяется не только то, что совет верный, но и то, что его
 * нет там, где данных мало — молчание безопаснее правдоподобной догадки.
 */

function session(over: Partial<SessionLog> = {}): SessionLog {
  return {
    performedOn: '2026-08-17',
    feeling: 'normal',
    painful: false,
    sets: [
      { weightKg: 60, reps: 10, rpe: 7 },
      { weightKg: 60, reps: 10, rpe: 7 },
      { weightKg: 60, reps: 10, rpe: 8 },
    ],
    ...over,
  };
}

function input(over: Partial<ProgressionInput> = {}): ProgressionInput {
  return {
    pattern: 'h_push',
    repMin: 8,
    repMax: 10,
    plannedSets: 3,
    history: [session(), session({ performedOn: '2026-08-14' })],
    ...over,
  };
}

describe('Прибавка веса', () => {
  test('две тренировки по верхней границе — прибавляем', () => {
    assert.deepEqual(advise(input()), { kind: 'increase', deltaKg: 2.5 });
  });

  test('изоляции прибавляем меньше', () => {
    // 2.5 кг на подъёме на бицепс — это плюс пятнадцать процентов,
    // а не следующий шаг
    const advice = advise(
      input({
        pattern: 'biceps',
        history: [
          session({ sets: [{ weightKg: 12, reps: 12, rpe: 7 }] }),
          session({ sets: [{ weightKg: 12, reps: 12, rpe: 7 }] }),
        ],
        repMin: 10,
        repMax: 12,
        plannedSets: 1,
      }),
    );
    assert.deepEqual(advice, { kind: 'increase', deltaKg: 1 });
  });

  test('без снаряда прибавляется повтор, а не вес', () => {
    const bodyweight = session({
      sets: [
        { weightKg: null, reps: 15, rpe: 7 },
        { weightKg: null, reps: 15, rpe: 7 },
      ],
    });
    assert.deepEqual(
      advise(input({ pattern: 'core', repMin: 12, repMax: 15, plannedSets: 2, history: [bodyweight, bodyweight] })),
      { kind: 'increase', deltaKg: null },
    );
  });
});

describe('Когда вес не двигаем', () => {
  test('одной тренировки мало', () => {
    // Человек мог выспаться и поесть — верхняя граница один раз ничего
    // не доказывает
    assert.equal(advise(input({ history: [session()] })), null);
  });

  test('далось тяжело — держим вес', () => {
    assert.deepEqual(
      advise(input({ history: [session({ feeling: 'hard' }), session()] })),
      { kind: 'hold' },
    );
  });

  test('подход на пределе тяжести — держим вес', () => {
    const limit = session({
      sets: [
        { weightKg: 60, reps: 10, rpe: 9 },
        { weightKg: 60, reps: 10, rpe: 8 },
        { weightKg: 60, reps: 10, rpe: 8 },
      ],
    });
    assert.deepEqual(advise(input({ history: [limit, session()] })), { kind: 'hold' });
  });

  test('недобор нижней границы — держим вес', () => {
    const short = session({
      sets: [
        { weightKg: 60, reps: 7, rpe: 9 },
        { weightKg: 60, reps: 6, rpe: 9 },
        { weightKg: 60, reps: 5, rpe: 10 },
      ],
    });
    assert.deepEqual(advise(input({ history: [short, session()] })), { kind: 'hold' });
  });

  test('подходов сделано меньше плана — совета нет', () => {
    // Диапазон формально выполнен, но тренировка не доделана: сказать
    // «прибавь» здесь значит не заметить, что человеку и так тяжело
    const partial = session({ sets: [{ weightKg: 60, reps: 10, rpe: 7 }] });
    assert.equal(advise(input({ history: [partial, partial] })), null);
  });
});

describe('Боль', () => {
  test('боль на упражнении — предлагаем замену сразу', () => {
    // Второго подтверждения не ждём: это была бы ещё одна тренировка
    // через боль
    assert.deepEqual(
      advise(input({ history: [session({ feeling: 'pain', painful: true })] })),
      { kind: 'replace' },
    );
  });

  test('боль важнее выполненного диапазона', () => {
    const hurt = session({ feeling: 'pain', painful: true });
    assert.deepEqual(advise(input({ history: [hurt, session()] })), {
      kind: 'replace',
    });
  });

  test('боль на другом упражнении этого не касается', () => {
    // painful относится к конкретному движению, а не ко всей тренировке
    assert.deepEqual(
      advise(input({ history: [session({ feeling: 'pain' }), session()] })),
      { kind: 'increase', deltaKg: 2.5 },
    );
  });
});

describe('Перегруженный день', () => {
  test('дважды меньше двух третей плана — день длинный', () => {
    assert.ok(
      overloaded([
        { plannedSets: 18, doneSets: 10 },
        { plannedSets: 18, doneSets: 11 },
      ]),
    );
  });

  test('одного раза мало', () => {
    assert.ok(
      !overloaded([
        { plannedSets: 18, doneSets: 10 },
        { plannedSets: 18, doneSets: 18 },
      ]),
    );
  });

  test('доделанная тренировка вопросов не вызывает', () => {
    assert.ok(
      !overloaded([
        { plannedSets: 18, doneSets: 17 },
        { plannedSets: 18, doneSets: 18 },
      ]),
    );
  });
});
