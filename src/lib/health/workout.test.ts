import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  setVolume,
  sessionVolume,
  estimateBurnKcal,
  bestSet,
} from './workout';

describe('Счёт нагрузки', () => {
  test('тоннаж подхода — вес на повторы', () => {
    assert.equal(setVolume(60, 8), 480);
  });

  test('подход без веса в тоннаж не входит', () => {
    // Подтягивания и планка веса не имеют, и приписывать им ноль килограммов
    // честнее, чем выдумывать вес тела: он в журнале не хранится
    assert.equal(setVolume(null, 12), 0);
    assert.equal(setVolume(0, 12), 0);
  });

  test('подход без повторов тоже не считается', () => {
    assert.equal(setVolume(60, null), 0);
  });

  test('тоннаж тренировки складывается по подходам', () => {
    const sets = [
      { weightKg: 60, reps: 8 },
      { weightKg: 60, reps: 8 },
      { weightKg: 65, reps: 6 },
      { weightKg: null, reps: 12 },
    ];
    assert.equal(sessionVolume(sets), 480 + 480 + 390);
  });
});

describe('Оценка расхода', () => {
  test('считается по формуле MET × вес × часы', () => {
    // 6 MET, 80 кг, час — типичная силовая тренировка
    assert.equal(estimateBurnKcal(6, 80, 60), 480);
    assert.equal(estimateBurnKcal(6, 80, 30), 240);
  });

  test('без длительности или веса тела не выдумывается', () => {
    // Показать «0 ккал» значило бы утверждать, что тренировки не было
    assert.equal(estimateBurnKcal(6, 80, null), null);
    assert.equal(estimateBurnKcal(6, null, 60), null);
    assert.equal(estimateBurnKcal(null, 80, 60), null);
  });
});

describe('Прошлый результат', () => {
  test('берётся подход с наибольшим весом', () => {
    const sets = [
      { weightKg: 60, reps: 8 },
      { weightKg: 70, reps: 5 },
      { weightKg: 65, reps: 6 },
    ];
    assert.deepEqual(bestSet(sets), { weightKg: 70, reps: 5 });
  });

  test('при равном весе выигрывает больше повторов', () => {
    const sets = [
      { weightKg: 70, reps: 5 },
      { weightKg: 70, reps: 8 },
    ];
    assert.deepEqual(bestSet(sets), { weightKg: 70, reps: 8 });
  });

  test('без силовых подходов результата нет', () => {
    assert.equal(bestSet([{ weightKg: null, reps: 12 }]), null);
    assert.equal(bestSet([]), null);
  });
});
