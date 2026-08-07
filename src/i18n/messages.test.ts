import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import ru from './messages/ru.json';
import kk from './messages/kk.json';

/**
 * Словари обязаны совпадать ключ в ключ.
 *
 * Забытый перевод в next-intl не падает, а показывает сам ключ — на экране
 * у казахоязычного пользователя появилось бы «weight.recorded» вместо
 * слова. Типы этого не ловят: они следят только за русским словарём.
 *
 * Заодно сверяются подстановки: если в одном языке `{kg}`, а в другом
 * `{kilo}`, строка соберётся с дырой на месте числа.
 */

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') flat.set(path, value);
    else for (const [k, v] of flatten(value, path)) flat.set(k, v);
  }
  return flat;
}

/** Имена подстановок вида {name}; плюрализация задаёт их первым словом */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*(\w+)/g)].map((m) => m[1]).sort();
}

const russian = flatten(ru as Tree);
const kazakh = flatten(kk as Tree);

describe('Словари перевода', () => {
  test('в казахском есть все ключи русского', () => {
    const missing = [...russian.keys()].filter((key) => !kazakh.has(key));
    assert.deepEqual(missing, []);
  });

  test('в казахском нет лишних ключей', () => {
    const extra = [...kazakh.keys()].filter((key) => !russian.has(key));
    assert.deepEqual(extra, []);
  });

  test('подстановки совпадают', () => {
    const mismatched: string[] = [];
    for (const [key, value] of russian) {
      const other = kazakh.get(key);
      if (!other) continue;
      if (placeholders(value).join(',') !== placeholders(other).join(',')) {
        mismatched.push(key);
      }
    }
    assert.deepEqual(mismatched, []);
  });

  test('пустых строк нет', () => {
    const empty = [...russian, ...kazakh]
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    assert.deepEqual(empty, []);
  });
});
