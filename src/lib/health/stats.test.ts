import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { summarize, dateRange, peakKcal, type DayStat } from './stats';

/**
 * Статистика — единственное место, где человек судит о своём питании
 * не по одному дню, а по месяцу. Ошибка здесь меняет его поведение:
 * заниженное среднее заставит есть больше, завышенное — урезать рацион.
 */

function day(over: Partial<DayStat> = {}): DayStat {
  return {
    date: '2026-08-01',
    kcal: 2200,
    proteinG: 150,
    fatG: 70,
    carbsG: 240,
    entryCount: 3,
    ...over,
  };
}

describe('Статистика питания', () => {
  test('дни без записей не занижают среднее', () => {
    // Тот самый случай: вёл дневник два дня по 2200, ещё два пропустил.
    // Если считать пропуски нулями, выйдет 1100 — и человек решит,
    // что недоедает вдвое
    const days = [
      day({ date: '2026-08-01', kcal: 2200 }),
      day({ date: '2026-08-02', kcal: 0, entryCount: 0 }),
      day({ date: '2026-08-03', kcal: 2200 }),
      day({ date: '2026-08-04', kcal: 0, entryCount: 0 }),
    ];

    const stats = summarize(days, 2200);
    assert.equal(stats.avgKcal, 2200);
    assert.equal(stats.daysLogged, 2);
    assert.equal(stats.daysTotal, 4);
  });

  test('отклонение от нормы знаковое: минус — недобор', () => {
    const days = [day({ kcal: 1800 }), day({ date: '2026-08-02', kcal: 2000 })];
    assert.equal(summarize(days, 2200).avgDeviation, -300);

    const over = [day({ kcal: 2500 }), day({ date: '2026-08-02', kcal: 2700 })];
    assert.equal(summarize(over, 2200).avgDeviation, 400);
  });

  test('в норму засчитывается попадание с допуском, а не точная цифра', () => {
    // Попасть в число невозможно: погрешность оценки веса порции сама
    // по себе больше сотни килокалорий
    const days = [
      day({ date: '2026-08-01', kcal: 2150 }), // в допуске
      day({ date: '2026-08-02', kcal: 2301 }), // мимо
      day({ date: '2026-08-03', kcal: 2100 }), // ровно на границе
      day({ date: '2026-08-04', kcal: 0, entryCount: 0 }), // не считается
    ];
    assert.equal(summarize(days, 2200).withinNormDays, 2);
  });

  test('без нормы отклонение не выдумывается', () => {
    const stats = summarize([day()], null);
    assert.equal(stats.avgDeviation, null);
    assert.equal(stats.withinNormDays, 0);
    assert.equal(stats.avgKcal, 2200, 'среднее считается и без цели');
  });

  test('пустой период не ломает расчёт', () => {
    const stats = summarize([], 2200);
    assert.equal(stats.avgKcal, null);
    assert.equal(stats.avgDeviation, null);
    assert.equal(stats.daysLogged, 0);
  });

  test('период отдаётся подряд, включая пропущенные дни', () => {
    const range = dateRange('2026-08-11', 5);
    assert.deepEqual(range, [
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
    ]);
  });

  test('период переходит через границу месяца', () => {
    // Разбор по частям, а не арифметика над строкой: 1 августа минус
    // три дня — это июль, и вычитание из числа дало бы «2026-08-(-2)»
    assert.deepEqual(dateRange('2026-08-02', 3), [
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  test('масштаб графика учитывает норму, а не только съеденное', () => {
    // Неделя недобора: без учёта нормы её линия ушла бы за верх графика
    const days = [day({ kcal: 1500 }), day({ date: '2026-08-02', kcal: 1600 })];
    assert.equal(peakKcal(days, 2200), 2200);
    assert.equal(peakKcal(days, null), 1600);
    assert.equal(peakKcal([], null), 1, 'нулём делить нельзя');
  });
});
