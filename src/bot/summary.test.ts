import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { formatDaySummary, type SummaryInput } from './summary';

/**
 * Закреплённая сводка висит в шапке чата постоянно, и человек смотрит
 * на неё чаще, чем на любой экран приложения. Ошибка здесь заметнее
 * любой другой: неверный остаток он увидит десять раз за день.
 */

function input(over: Partial<SummaryInput> = {}): SummaryInput {
  return {
    locale: 'ru',
    date: '2026-08-10',
    dateLabel: '10 августа',
    totals: { kcal: 761, proteinG: 19.4, fatG: 16.2, carbsG: 141.3, entryCount: 2 },
    meals: [
      { mealType: 'lunch', kcal: 548 },
      { mealType: 'snack', kcal: 213 },
    ],
    goal: {
      kcalTarget: 2395,
      proteinTargetG: 198,
      fatTargetG: 72,
      carbTargetG: 239,
    },
    ...over,
  };
}

describe('Сводка дня в закреплённом сообщении', () => {
  test('главное число — остаток, а не съеденное', () => {
    // Человек открывает бота с вопросом «сколько мне ещё можно»,
    // а не «сколько я уже съел»
    const text = formatDaySummary(input());
    assert.match(text, /<b>Осталось 1634 ккал<\/b>/);
    assert.match(text, /Съедено 761 из 2395/);
  });

  test('перебор показывается отдельно от остатка', () => {
    const text = formatDaySummary(
      input({
        totals: { kcal: 2600, proteinG: 150, fatG: 80, carbsG: 300, entryCount: 4 },
      }),
    );
    assert.match(text, /Перебор 205 ккал/);
    assert.doesNotMatch(text, /Осталось/);
  });

  test('нутриенты идут с нормой, а не сами по себе', () => {
    // «19 г белка» ничего не говорит, «19/198» говорит всё
    assert.match(formatDaySummary(input()), /Б 19\/198 · Ж 16\/72 · У 141\/239 г/);
  });

  test('без цели показывается съеденное без выдуманной нормы', () => {
    const text = formatDaySummary(input({ goal: null }));
    assert.match(text, /Съедено 761 ккал/);
    assert.doesNotMatch(text, /Осталось/);
    assert.doesNotMatch(text, /из/);
  });

  test('приёмы пищи перечислены по порядку', () => {
    const text = formatDaySummary(input());
    assert.ok(text.indexOf('Обед') < text.indexOf('Перекус'));
    assert.match(text, /• Обед — 548 ккал/);
  });

  test('пустой день зовёт записать, а не показывает нули молча', () => {
    const text = formatDaySummary(
      input({
        meals: [],
        totals: { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0, entryCount: 0 },
      }),
    );
    assert.match(text, /Записей пока нет/);
  });

  test('тренировка показана тоннажем и не превращается в калории', () => {
    // Расход уже учтён коэффициентом активности в норме: показать его
    // здесь значило бы предложить эти калории съесть
    const text = formatDaySummary(input({ workoutVolumeKg: 4200 }));
    assert.match(text, /Тренировка: поднято 4200 кг/);
    assert.doesNotMatch(text, /сожжено|расход/i);
  });

  test('без тренировки строки о ней нет', () => {
    assert.doesNotMatch(formatDaySummary(input()), /Тренировка/);
    assert.doesNotMatch(formatDaySummary(input({ workoutVolumeKg: 0 })), /Тренировка/);
  });

  test('казахская сводка не содержит русских слов', () => {
    const text = formatDaySummary(input({ locale: 'kk' }));
    assert.match(text, /1634 ккал қалды/);
    assert.match(text, /Түскі ас/);
    assert.doesNotMatch(text, /Осталось|Обед/);
  });
});
