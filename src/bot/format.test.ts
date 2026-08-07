import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { formatEntrySummary, escapeHtml } from './format';
import type { ResolvedItem } from '@/lib/nutrition/resolve';
import type { Recognition } from '@/lib/ai/schemas';

/**
 * Карточка разбора — единственное, что человек видит в боте после снимка,
 * и единственное место, где решение «не выдумывать калории» становится
 * видимым: позиция без нутриентов обязана отличаться от нулевой.
 */

function item(over: Partial<ResolvedItem['item']> = {}): ResolvedItem['item'] {
  return {
    nameRu: 'Куырдак',
    nameEn: 'kuyrdak',
    grams: 220,
    confidence: 0.85,
    preparation: 'fried',
    uncertainty: '',
    ...over,
  };
}

const withNutrition: ResolvedItem = {
  item: item(),
  product: null,
  nutrition: { kcal: 510, proteinG: 33.4, fatG: 38.3, carbsG: 10.1 },
  matchedBy: 'local',
};

const withoutNutrition: ResolvedItem = {
  item: item({ nameRu: 'Соус к мясу', grams: 30 }),
  product: null,
  nutrition: null,
  matchedBy: 'none',
};

const recognition: Recognition = {
  isFood: true,
  mealType: 'lunch',
  items: [],
  notes: '',
};

const total = { kcal: 510, proteinG: 33.4, fatG: 38.3, carbsG: 10.1 };

describe('Карточка разбора', () => {
  test('по умолчанию говорит по-русски', () => {
    const text = formatEntrySummary({
      recognition,
      resolved: [withNutrition],
      total,
    });
    assert.match(text, /<b>Обед<\/b>/);
    assert.match(text, /Итого: 510 ккал/);
    assert.match(text, /Б 33\.4 · Ж 38\.3 · У 10\.1/);
  });

  test('на казахском переводится целиком', () => {
    const text = formatEntrySummary({
      recognition,
      resolved: [withNutrition],
      total,
      locale: 'kk',
    });
    assert.match(text, /<b>Түскі ас<\/b>/);
    assert.match(text, /Барлығы: 510 ккал/);
    // Русских слов интерфейса остаться не должно — кроме названия блюда,
    // которое так назвала модель
    assert.doesNotMatch(text, /Итого|Обед/);
  });

  test('позиция без нутриентов не выглядит нулевой', () => {
    const text = formatEntrySummary({
      recognition,
      resolved: [withNutrition, withoutNutrition],
      total,
    });
    assert.match(text, /Соус к мясу — 30 г ❓/);
    assert.match(text, /нет в справочнике/);
    assert.doesNotMatch(text, /Соус к мясу — 30 г · <b>0 ккал/);
    // И отдельной строкой сказано, что итог неполный
    assert.match(text, /Итог посчитан без 1 позиции/);
  });

  test('русское склонение в числе непосчитанных позиций', () => {
    const many = [withoutNutrition, withoutNutrition, withoutNutrition];
    const text = formatEntrySummary({ recognition, resolved: many, total });
    assert.match(text, /без 3 позиций/);
  });

  test('низкая уверенность объясняется словами модели', () => {
    const shaky: ResolvedItem = {
      ...withNutrition,
      item: item({ confidence: 0.3, uncertainty: 'Не видно дна тарелки' }),
    };
    const text = formatEntrySummary({ recognition, resolved: [shaky], total });
    assert.match(text, /⚠️ Не видно дна тарелки/);
  });

  test('блюдо, собранное по составу, помечено знаком приблизительности', () => {
    const derived: ResolvedItem = { ...withNutrition, matchedBy: 'derived' };
    const text = formatEntrySummary({ recognition, resolved: [derived], total });
    assert.match(text, /≈510 ккал/);
    assert.match(text, /калорийность собрана по составу/);
  });

  test('дневной итог показывает перебор отдельно от остатка', () => {
    const over = formatEntrySummary({
      recognition,
      resolved: [withNutrition],
      total,
      dayKcal: 2400,
      dayTargetKcal: 2209,
    });
    assert.match(over, /перебор 191/);

    const left = formatEntrySummary({
      recognition,
      resolved: [withNutrition],
      total,
      dayKcal: 1700,
      dayTargetKcal: 2209,
    });
    assert.match(left, /осталось 509/);
  });

  test('разметка в названии блюда экранируется', () => {
    const tricky: ResolvedItem = {
      ...withNutrition,
      item: item({ nameRu: 'Салат <b>«Цезарь»</b> & Ко' }),
    };
    const text = formatEntrySummary({ recognition, resolved: [tricky], total });
    assert.match(text, /&lt;b&gt;/);
    assert.match(text, /&amp; Ко/);
    assert.equal(escapeHtml('<i>&</i>'), '&lt;i&gt;&amp;&lt;/i&gt;');
  });
});
