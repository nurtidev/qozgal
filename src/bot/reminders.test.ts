import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMetric,
  looksLikeWeight,
  looksLikeWaist,
  shouldAskWeight,
  shouldAskWaist,
  ASK_HOUR,
  WAIST_EVERY_DAYS,
} from './reminders';

/**
 * Цена ошибки здесь двусторонняя: не спросить — и график веса останется
 * из трёх точек; спросить лишний раз — и человек отключит бота вместе
 * с напоминаниями и дневником. Поэтому правила проверяются тестом, а не
 * наблюдением за живым чатом.
 */

describe('Что считать замером', () => {
  test('число с единицами и без — замер', () => {
    assert.equal(parseMetric('73.4'), 73.4);
    assert.equal(parseMetric('73,4'), 73.4);
    assert.equal(parseMetric('73.4 кг'), 73.4);
    assert.equal(parseMetric('73 kg'), 73);
    assert.equal(parseMetric('  81 см '), 81);
    assert.equal(parseMetric('81см'), 81);
  });

  test('описание еды замером не считается', () => {
    // Главное разграничение: текст уходит в разбор еды, и ошибка здесь
    // стоит потерянного приёма пищи
    assert.equal(parseMetric('200 г риса'), null);
    assert.equal(parseMetric('2 яйца'), null);
    assert.equal(parseMetric('чай с молоком'), null);
    assert.equal(parseMetric('300 г курицы и салат'), null);
    assert.equal(parseMetric(''), null);
  });

  test('границы отделяют опечатку от замера', () => {
    assert.ok(looksLikeWeight(73.4));
    assert.ok(!looksLikeWeight(7.3), 'семь килограммов — это не человек');
    assert.ok(!looksLikeWeight(734));

    assert.ok(looksLikeWaist(81));
    assert.ok(!looksLikeWaist(8));
  });
});

describe('Когда спрашивать вес', () => {
  function state(over: Partial<Parameters<typeof shouldAskWeight>[0]> = {}) {
    return {
      remindersOn: true,
      hour: ASK_HOUR,
      localDate: '2026-08-12',
      weightAskedOn: null,
      hasWeightToday: false,
      ...over,
    };
  }

  test('утром, если вес за сегодня не записан', () => {
    assert.ok(shouldAskWeight(state()));
    assert.ok(shouldAskWeight(state({ hour: ASK_HOUR + 1 })));
  });

  test('дважды за день не спрашиваем', () => {
    // Интервал просыпается каждые десять минут: без отметки вопрос уходил бы
    // шесть раз в час
    assert.ok(!shouldAskWeight(state({ weightAskedOn: '2026-08-12' })));
    assert.ok(shouldAskWeight(state({ weightAskedOn: '2026-08-11' })));
  });

  test('взвесился сам — вопроса нет', () => {
    assert.ok(!shouldAskWeight(state({ hasWeightToday: true })));
  });

  test('вне утреннего окна молчим', () => {
    // Вопрос про вес натощак в четыре часа дня бессмыслен
    assert.ok(!shouldAskWeight(state({ hour: 6 })));
    assert.ok(!shouldAskWeight(state({ hour: 16 })));
    assert.ok(!shouldAskWeight(state({ hour: 23 })));
  });

  test('отключённые напоминания молчат всегда', () => {
    assert.ok(!shouldAskWeight(state({ remindersOn: false })));
  });
});

describe('Когда спрашивать талию', () => {
  test('без первого замера не спрашиваем', () => {
    // Записать одну талию некуда: обхват шеи в записи обязателен, он нужен
    // для процента жира, и взять его можно только из прошлого замера
    assert.ok(
      !shouldAskWaist({
        localDate: '2026-08-12',
        lastWaistOn: null,
        waistAskedOn: null,
      }),
    );
  });

  test('через две недели после последнего замера', () => {
    const localDate = '2026-08-12';
    assert.ok(
      !shouldAskWaist({ localDate, lastWaistOn: '2026-08-05', waistAskedOn: null }),
      'через неделю разница обычно в пределах погрешности ленты',
    );
    assert.ok(
      shouldAskWaist({ localDate, lastWaistOn: '2026-07-29', waistAskedOn: null }),
      `${WAIST_EVERY_DAYS} дней прошло — пора`,
    );
  });

  test('в один день дважды не спрашиваем', () => {
    assert.ok(
      !shouldAskWaist({
        localDate: '2026-08-12',
        lastWaistOn: null,
        waistAskedOn: '2026-08-12',
      }),
    );
  });
});
