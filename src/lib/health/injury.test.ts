import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { conflictsFor, worstSeverity, type ActiveInjury } from './injury';

/**
 * Сопоставление травм с упражнениями — детерминированное, по разметке
 * справочника. Эти тесты защищают именно это свойство: одинаковый вход
 * обязан давать одинаковый ответ, а пропуск опасного движения — худшая
 * из возможных ошибок раздела.
 */

const backPain: ActiveInjury = { area: 'lower_back', severity: 'pain' };
const kneeBan: ActiveInjury = { area: 'knee', severity: 'medical' };
const kneeWatch: ActiveInjury = { area: 'knee', severity: 'watch' };

/* Разметка настоящих карточек справочника */
const DEADLIFT = ['lower_back', 'hip', 'knee'];
const LATERAL_RAISE = ['shoulder'];
const WALKING: string[] = [];

describe('Травмы и упражнения', () => {
  test('становая тяга задевает больную поясницу', () => {
    const conflicts = conflictsFor(DEADLIFT, [backPain]);
    assert.deepEqual(conflicts, [{ area: 'lower_back', severity: 'pain' }]);
  });

  test('махи в стороны поясницу не задевают', () => {
    assert.deepEqual(conflictsFor(LATERAL_RAISE, [backPain]), []);
  });

  test('одно движение попадает сразу в две травмы', () => {
    // Становая нагружает и поясницу, и колено — человек должен видеть обе
    const conflicts = conflictsFor(DEADLIFT, [backPain, kneeBan]);
    assert.equal(conflicts.length, 2);
    assert.ok(conflicts.some((c) => c.area === 'lower_back'));
    assert.ok(conflicts.some((c) => c.area === 'knee'));
  });

  test('из двух записей об одной области берётся тяжёлая', () => {
    // «Врач запретил» весомее, чем «беспокоит»: предупреждение должно
    // отражать худшее, а не последнее записанное
    const conflicts = conflictsFor(DEADLIFT, [kneeWatch, kneeBan]);
    const knee = conflicts.find((c) => c.area === 'knee');
    assert.equal(knee?.severity, 'medical');
  });

  test('упражнение без разметки не помечается', () => {
    // Ходьба ничего не нагружает — и молчание тут правильное
    assert.deepEqual(conflictsFor(WALKING, [backPain, kneeBan]), []);
    assert.deepEqual(conflictsFor(null, [backPain]), []);
  });

  test('без активных травм пометок нет', () => {
    assert.deepEqual(conflictsFor(DEADLIFT, []), []);
  });

  test('худшая степень определяет тон предупреждения', () => {
    assert.equal(
      worstSeverity([
        { area: 'lower_back', severity: 'watch' },
        { area: 'knee', severity: 'medical' },
      ]),
      'medical',
    );
    assert.equal(worstSeverity([]), null);
  });
});
