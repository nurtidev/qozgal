import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  calibrate,
  dailyKcalImpact,
  isEdited,
  median,
  quantile,
  relativeError,
  summarize,
  MIN_EDITS_FOR_VERDICT,
  type WeightSample,
} from './calibration';

/**
 * Калибровка — единственное место, где приложение проверяет само себя
 * на живых данных. Ошибка в этих расчётах хуже отсутствия отчёта:
 * выдуманное смещение приведёт к правке промпта, которая испортит
 * работающую оценку.
 */

function sample(over: Partial<WeightSample> = {}): WeightSample {
  return {
    estimatedG: 100,
    finalG: 100,
    confidence: 0.9,
    source: 'photo',
    matched: true,
    ...over,
  };
}

describe('Калибровка оценки веса', () => {
  test('правкой считается расхождение от грамма', () => {
    // Округление до десятых — не мнение человека о весе
    assert.equal(isEdited(sample({ estimatedG: 90, finalG: 90.4 })), false);
    assert.equal(isEdited(sample({ estimatedG: 90, finalG: 91 })), true);
  });

  test('знак ошибки: плюс означает, что модель занижала', () => {
    assert.equal(relativeError(sample({ estimatedG: 100, finalG: 120 })), 0.2);
    assert.equal(relativeError(sample({ estimatedG: 100, finalG: 80 })), -0.2);
    // Нулевая оценка ломала бы деление; такой позиции просто нет мнения
    assert.equal(relativeError(sample({ estimatedG: 0, finalG: 50 })), 0);
  });

  test('медиана не уезжает от одного выброса', () => {
    assert.equal(median([1, 2, 3]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    // Тот самый случай: вместо 200 г человек набрал 2000
    assert.equal(median([0.1, 0.1, 0.1, 9]), 0.1);
    assert.equal(median([]), null);
  });

  test('квантили описывают разброс правок', () => {
    const values = [-0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5];
    assert.equal(quantile(values, 0.25), -0.1);
    assert.equal(quantile(values, 0.75), 0.3);
    assert.equal(quantile([], 0.5), null);
  });

  test('смещение по правленым выше, чем по всем позициям', () => {
    // Двое поправили вес вверх, восемь согласились не глядя — и по всем
    // позициям смещение выглядит нулевым, хотя проблема есть
    const samples = [
      ...Array.from({ length: 8 }, () => sample()),
      sample({ estimatedG: 100, finalG: 150 }),
      sample({ estimatedG: 200, finalG: 300 }),
    ];

    const slice = summarize('тест', samples);
    assert.equal(slice.count, 10);
    assert.equal(slice.edits, 2);
    assert.equal(slice.editShare, 0.2);
    assert.equal(slice.biasEdited, 0.5);
    assert.equal(slice.biasAll, 0);
  });

  test('малая выборка не даёт делать выводы', () => {
    const few = Array.from({ length: MIN_EDITS_FOR_VERDICT - 1 }, () =>
      sample({ estimatedG: 100, finalG: 130 }),
    );
    assert.equal(calibrate(few).enoughData, false);

    const enough = Array.from({ length: MIN_EDITS_FOR_VERDICT }, () =>
      sample({ estimatedG: 100, finalG: 130 }),
    );
    assert.equal(calibrate(enough).enoughData, true);
  });

  test('разрезы отвечают на вопросы, ради которых сделаны', () => {
    const samples = [
      // Фото: человек стабильно добавляет вес
      ...Array.from({ length: 6 }, () => sample({ estimatedG: 100, finalG: 130 })),
      // Текст: вес назван словами, правок нет
      ...Array.from({ length: 4 }, () => sample({ source: 'text' })),
      // Неуверенные позиции — отдельная группа
      sample({ confidence: 0.3, estimatedG: 100, finalG: 200 }),
      // Позиция без карточки в справочнике
      sample({ matched: false, estimatedG: 50, finalG: 60 }),
    ];

    const report = calibrate(samples);

    const photo = report.bySource.find((s) => s.label === 'photo');
    const text = report.bySource.find((s) => s.label === 'text');
    assert.equal(photo?.biasEdited, 0.3, 'по фото модель занижала на 30%');
    assert.equal(text?.edits, 0, 'описанный словами вес править не приходится');

    const unsure = report.byConfidence.find((s) => s.label === 'уверенность < 0.5');
    assert.equal(unsure?.count, 1);
    assert.equal(unsure?.biasEdited, 1);

    const unmatched = report.byMatch.find((s) => s.label === 'не нашлось');
    assert.equal(unmatched?.count, 1);
  });

  test('смещение переводится в килокалории дня', () => {
    // 12% при рационе 2200 — это 264 ккал мимо дневника
    assert.equal(dailyKcalImpact(0.12, 2200), 264);
    assert.equal(dailyKcalImpact(-0.05, 2000), -100);
  });

  test('пустая выборка не роняет отчёт', () => {
    const report = calibrate([]);
    assert.equal(report.overall.count, 0);
    assert.equal(report.overall.biasEdited, null);
    assert.equal(report.enoughData, false);
    assert.deepEqual(report.spread, { p25: null, p75: null });
  });
});
