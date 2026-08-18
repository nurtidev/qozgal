import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { pickBestMatch, scoreCandidate } from './match';
import type { NewProduct } from '@/db/schema';

/**
 * Описания в тестах — настоящие строки USDA, не сочинённые. Смысл проверки
 * именно в них: алгоритм разбирает чужую номенклатуру, и выдуманный пример
 * подтвердил бы только то, что он согласен сам с собой.
 *
 * Калорийность указана там, где она объясняет цену ошибки.
 */

function usda(description: string, over: Partial<NewProduct> = {}): NewProduct {
  return {
    nameRu: description,
    nameEn: description,
    source: 'usda',
    externalId: description,
    kcalPer100g: 100,
    proteinPer100g: 1,
    fatPer100g: 1,
    carbsPer100g: 1,
    // Foundation и SR Legacy — лабораторные измерения; в кандидатах USDA
    // это большинство, поэтому true по умолчанию
    isVerified: true,
    ...over,
  };
}

describe('Ошибка с яблоком', () => {
  // Тот самый случай: 25 ккал/100 г у розового яблока против 52 у обычного
  const rose = usda('Rose-apples, raw', { kcalPer100g: 25 });
  const apple = usda('Apples, raw, with skin', { kcalPer100g: 52 });

  test('обычное яблоко выигрывает у розового, как бы USDA их ни отсортировал', () => {
    // Порядок выдачи USDA ставил розовое первым — это и была ошибка
    assert.equal(pickBestMatch({ nameEn: 'apple' }, [rose, apple]), apple);
    assert.equal(pickBestMatch({ nameEn: 'apple' }, [apple, rose]), apple);
  });

  test('розовое яблоко в одиночку не выбирается вовсе', () => {
    // Ключевое решение: лучше отдать позицию на разложение по ингредиентам
    // и ручной ввод, чем занизить день вдвое правдоподобным числом
    assert.equal(pickBestMatch({ nameEn: 'apple' }, [rose]), null);
  });

  test('яблочный сок не отвечает на запрос про яблоко', () => {
    const juice = usda('Apple juice, canned or bottled, unsweetened');
    assert.equal(pickBestMatch({ nameEn: 'apple' }, [juice]), null);
  });

  test('множественное число в описании не мешает', () => {
    assert.notEqual(scoreCandidate({ nameEn: 'apple' }, apple), null);
    assert.notEqual(scoreCandidate({ nameEn: 'apples' }, usda('Apple, raw')), null);
  });
});

describe('Состояние продукта', () => {
  // Сухая гречка 343 ккал/100 г, варёная — 92. Ошибка кратная, не процентная
  const dry = usda('Buckwheat', { kcalPer100g: 343 });
  const cooked = usda('Buckwheat groats, roasted, cooked', { kcalPer100g: 92 });

  test('варёное блюдо не отвечается сухим зерном', () => {
    const best = pickBestMatch(
      { nameEn: 'buckwheat', preparation: 'boiled' },
      [dry, cooked],
    );
    assert.equal(best, cooked);
  });

  test('без указания приготовления выигрывает более чистое имя', () => {
    // Модель не сказала, как приготовлено, — гадать за неё нечем
    assert.equal(pickBestMatch({ nameEn: 'buckwheat' }, [dry, cooked]), dry);
  });

  test('сырое вместо жареного отбрасывается', () => {
    const raw = usda('Potatoes, raw', { kcalPer100g: 77 });
    const score = scoreCandidate({ nameEn: 'potato', preparation: 'fried' }, raw);
    assert.ok(score !== null && score < 1.5, `ожидался отказ, получено ${score}`);
  });

  test('жареная картошка находится', () => {
    const fries = usda('Potatoes, french fried, all types, salted', {
      kcalPer100g: 274,
    });
    const raw = usda('Potatoes, raw', { kcalPer100g: 77 });
    const best = pickBestMatch(
      { nameEn: 'potato', preparation: 'fried' },
      [raw, fries],
    );
    assert.equal(best, fries);
  });
});

describe('Отбраковка непохожего', () => {
  test('отсутствующее значимое слово — отказ', () => {
    // USDA отвечает по частичному совпадению и на «beshbarmak» вернёт
    // что угодно; взять «что угодно» нельзя
    assert.equal(scoreCandidate({ nameEn: 'beshbarmak' }, usda('Rice, white, cooked')), null);
  });

  test('запрос без значимых слов ничего не выбирает', () => {
    assert.equal(scoreCandidate({ nameEn: 'boiled' }, usda('Rice, white, cooked')), null);
    assert.equal(scoreCandidate({ nameEn: '' }, usda('Rice, white, cooked')), null);
  });

  test('русское название до USDA не доходит и не притворяется совпадением', () => {
    assert.equal(scoreCandidate({ nameEn: 'куырдак' }, usda('Rice, white, cooked')), null);
  });

  test('пустая выдача даёт null, а не исключение', () => {
    assert.equal(pickBestMatch({ nameEn: 'apple' }, []), null);
  });
});

describe('Другой продукт под тем же словом', () => {
  // Всё это USDA отдавала на «apple» в живой выдаче, причём выше настоящего
  // яблока: 254, 296 и 243 ккал против 48
  test('начинка выпечки не отвечает на запрос про продукт', () => {
    assert.equal(pickBestMatch({ nameEn: 'apple' }, [usda('Croissants, apple')]), null);
    assert.equal(pickBestMatch({ nameEn: 'apple' }, [usda('Pie, apple')]), null);
    assert.equal(pickBestMatch({ nameEn: 'apple' }, [usda('Cake or cupcake, apple')]), null);
  });

  test('сухофрукт не отвечает на запрос про свежий продукт', () => {
    assert.equal(pickBestMatch({ nameEn: 'apple' }, [usda('Apple, dried')]), null);
    assert.equal(
      pickBestMatch({ nameEn: 'banana' }, [usda('Bananas, dehydrated, or banana powder')]),
      null,
    );
  });

  test('запрос про пирог находит пирог', () => {
    // Отбраковка работает только на слова, которых нет в запросе
    const pie = usda('Pie, apple');
    assert.equal(pickBestMatch({ nameEn: 'apple pie' }, [pie]), pie);
  });

  test('молочный продукт не отвечает на запрос про молоко', () => {
    // 299 ккал у моцареллы против 61 у молока
    const mozzarella = usda('Cheese, mozzarella, whole milk', { kcalPer100g: 299 });
    assert.equal(pickBestMatch({ nameEn: 'whole milk' }, [mozzarella]), null);
  });

  test('похожий фрукт с чужим уточнением не проходит', () => {
    // `Sugar-apples` — аннона, 94 ккал; слово «sugar» стоит в словаре
    // уточнений, поэтому имя выглядело чистым
    const sweetsop = usda('Sugar-apples, (sweetsop), raw', { kcalPer100g: 94 });
    assert.equal(pickBestMatch({ nameEn: 'apple' }, [sweetsop]), null);
  });
});

describe('Части продукта', () => {
  test('кожура не отвечает на запрос про картофель', () => {
    const skin = usda('Potatoes, boiled, cooked in skin, skin, with salt', {
      kcalPer100g: 78,
    });
    const flesh = usda('Potatoes, boiled, cooked in skin, flesh, with salt', {
      kcalPer100g: 87,
    });
    assert.equal(pickBestMatch({ nameEn: 'potato', preparation: 'boiled' }, [skin, flesh]), flesh);
    assert.equal(pickBestMatch({ nameEn: 'potato', preparation: 'boiled' }, [skin]), null);
  });

  test('жир с туши не отвечает на запрос про мясо', () => {
    // 554 ккал вместо 190 — втрое; это была самая дорогая ошибка в пробе
    const fat = usda('Lamb, Australian, imported, fresh, external fat, cooked', {
      kcalPer100g: 554,
    });
    assert.equal(pickBestMatch({ nameEn: 'lamb', preparation: 'boiled' }, [fat]), null);
  });

  test('«с кожурой» остаётся уточнением, а не частью', () => {
    const withSkin = usda('Apples, raw, with skin', { kcalPer100g: 52 });
    assert.notEqual(pickBestMatch({ nameEn: 'apple' }, [withSkin]), null);
    const inSkin = usda('Potatoes, boiled, cooked in skin, flesh', { kcalPer100g: 87 });
    assert.notEqual(
      pickBestMatch({ nameEn: 'potato', preparation: 'boiled' }, [inSkin]),
      null,
    );
  });
});

describe('Способ приготовления', () => {
  test('тушёное не отвечает на запрос про жареное', () => {
    // 103 ккал против 197 у настоящей жареной
    const stewed = usda('Stewed potatoes', { kcalPer100g: 103 });
    assert.equal(pickBestMatch({ nameEn: 'potato', preparation: 'fried' }, [stewed]), null);
  });

  test('«просто приготовленное» не отвечает на запрос про жареное', () => {
    // Масло, впитавшееся при жарке, удваивает калорийность, и ни одно
    // слово в описании о нём не скажет
    const cooked = usda('Potato, cooked, as ingredient', { kcalPer100g: 81 });
    assert.equal(pickBestMatch({ nameEn: 'potato', preparation: 'fried' }, [cooked]), null);
  });

  test('«просто приготовленное» годится для варки', () => {
    const cooked = usda('Rice, cooked, NFS', { kcalPer100g: 129 });
    assert.equal(pickBestMatch({ nameEn: 'rice', preparation: 'boiled' }, [cooked]), cooked);
  });

  test('замороженный полуфабрикат не отвечает на запрос про блюдо', () => {
    const frozen = usda(
      'Potatoes, french fried, all types, salt not added in processing, frozen, as purchased',
      { kcalPer100g: 147 },
    );
    assert.equal(pickBestMatch({ nameEn: 'potato', preparation: 'fried' }, [frozen]), null);
  });

  test('микроволновка не отвечает на запрос про жарку', () => {
    const microwaved = usda('Potatoes, microwaved, cooked, in skin, flesh', {
      kcalPer100g: 132,
    });
    const fried = usda('Potato, french fries, from fresh, fried', { kcalPer100g: 198 });
    const best = pickBestMatch({ nameEn: 'potato', preparation: 'fried' }, [microwaved, fried]);
    assert.equal(best, fried);
  });
});

describe('Отказ вместо угадывания', () => {
  test('кратное расхождение при равном счёте — отказ', () => {
    // Недоопределённый запрос: обе карточки одинаково подходят по имени
    const cheese = usda('Bread, cheese', { kcalPer100g: 408 });
    const white = usda('Bread, white', { kcalPer100g: 145 });
    assert.equal(pickBestMatch({ nameEn: 'bread' }, [cheese, white]), null);
  });

  test('разброс внутри сорта отказа не вызывает', () => {
    // 48 против 52 — разница меньше погрешности оценки веса порции,
    // и отказ здесь только отправил бы человека считать руками
    const withSkin = usda('Apples, raw, with skin', { kcalPer100g: 52 });
    const without = usda('Apples, raw, without skin', { kcalPer100g: 48 });
    assert.notEqual(pickBestMatch({ nameEn: 'apple' }, [withSkin, without]), null);
  });
});

describe('Номенклатура USDA', () => {
  test('уточняющее слово как продукт: запрос «sugar»', () => {
    // «sugar» стоит в словаре уточнений («with added sugar»), и запрос
    // из одного такого слова не имел ни одного значимого — отваливались
    // все кандидаты, включая `Sugars, granulated`
    const granulated = usda('Sugars, granulated', { kcalPer100g: 385 });
    assert.equal(pickBestMatch({ nameEn: 'sugar' }, [granulated]), granulated);
  });

  test('форма зерна не считается примесью', () => {
    const groats = usda('Buckwheat groats, roasted, cooked', { kcalPer100g: 92 });
    assert.equal(
      pickBestMatch({ nameEn: 'buckwheat', preparation: 'boiled' }, [groats]),
      groats,
    );
  });

  test('категория в первом сегменте не мешает совпадению', () => {
    // `Beverages, coffee, brewed` — совпадение стоит во втором сегменте,
    // и это норма USDA, а не признак другого продукта
    const coffee = usda('Beverages, coffee, brewed, prepared with tap water');
    assert.notEqual(pickBestMatch({ nameEn: 'coffee' }, [coffee]), null);
  });

  test('уточнения сорта не отбрасывают кандидата', () => {
    const chicken = usda(
      'Chicken, broilers or fryers, breast, meat only, cooked, roasted',
    );
    const best = pickBestMatch(
      { nameEn: 'chicken breast', preparation: 'grilled' },
      [chicken],
    );
    assert.equal(best, chicken);
  });

  test('совпавшее уточнение перебивает несовпавшее', () => {
    // Цельное молоко 61 ккал/100 г против обезжиренного 34 — запрос
    // «whole milk» обязан различать их
    const whole = usda('Milk, whole, 3.25% milkfat, with added vitamin D', {
      kcalPer100g: 61,
    });
    const skim = usda('Milk, nonfat, fluid, with added vitamin A and vitamin D', {
      kcalPer100g: 34,
    });
    assert.equal(pickBestMatch({ nameEn: 'whole milk' }, [skim, whole]), whole);
  });

  test('лабораторное измерение важнее усреднённого блюда при равном имени', () => {
    const survey = usda('Rice, white, cooked', { isVerified: false });
    const legacy = usda('Rice, white, cooked', { isVerified: true });
    assert.equal(pickBestMatch({ nameEn: 'rice', preparation: 'boiled' }, [survey, legacy]), legacy);
  });

  test('из равных по счёту берётся более короткое описание', () => {
    const short = usda('Rice, white, cooked');
    const long = usda('Rice, white, cooked, unsalted, with added vitamin');
    assert.equal(pickBestMatch({ nameEn: 'rice', preparation: 'boiled' }, [long, short]), short);
  });
});

/**
 * Готовые изделия — случай из живого бота: наггетсы распознались, но остались
 * без калорий, и день показал ноль при 230 граммах съеденного.
 */
describe('Готовые изделия', () => {
  const ready = usda('Chicken nuggets, NFS', { kcalPer100g: 307, isVerified: false });

  test('жареное по своей природе не требует слова «fried» в описании', () => {
    // Модель называет наггетсы жареными, и это правда. Но в USDA слова
    // «fried» нет ни у одного варианта, а правило «для жарки нужно точное
    // совпадение» отбраковывало все 127 кандидатов
    const best = pickBestMatch(
      { nameEn: 'chicken nuggets', preparation: 'fried' },
      [ready],
    );
    assert.equal(best, ready);
  });

  test('замороженный полуфабрикат всё равно отбраковывается', () => {
    const frozen = usda('Chicken, nuggets, white meat, precooked, frozen, not reheated', {
      kcalPer100g: 261,
    });
    const best = pickBestMatch(
      { nameEn: 'chicken nuggets', preparation: 'fried' },
      [frozen, ready],
    );
    assert.equal(best, ready);
  });

  test('«not reheated» не считается подтверждением готовности', () => {
    // Слово «not» служебное и выбрасывается при токенизации, поэтому
    // отрицание проверяется по соседству слов
    const frozen = usda('Chicken, nuggets, precooked, frozen, not reheated', {
      kcalPer100g: 261,
    });
    assert.equal(pickBestMatch({ nameEn: 'chicken nuggets' }, [frozen]), null);
  });

  test('сырому продукту послабление не даётся', () => {
    // Правило про готовые изделия не должно превратиться в дыру: картошка
    // изделием не является, и «просто приготовленная» вместо жареной
    // по-прежнему занижает вдвое
    const cooked = usda('Potato, cooked, as ingredient', { kcalPer100g: 81 });
    assert.equal(
      pickBestMatch({ nameEn: 'potato', preparation: 'fried' }, [cooked]),
      null,
    );
  });
});

/**
 * Фастфуд — случай из живого дневника: «Бургер с двойной говядиной» на 280 г
 * ушёл в день без калорий и без белка, потому что не нашлась ни карточка
 * бургера, ни котлета для разложения на ингредиенты.
 */
describe('Составные блюда', () => {
  test('жирность фарша — не «часть туши»', () => {
    // `fat` в описании ловилось правилом про жир с туши, и лучшая карточка
    // котлеты отбраковывалась. Проценты в сегменте означают состав
    const patty = usda('Beef, ground, 80% lean meat / 20% fat, patty, cooked, broiled', {
      kcalPer100g: 270,
    });
    assert.equal(pickBestMatch({ nameEn: 'beef patty' }, [patty]), patty);
  });

  test('жир с туши по-прежнему отбраковывается', () => {
    // Проверка, что послабление не стало дырой: у этой карточки процентов
    // нет, и она остаётся жиром, а не мясом
    const fat = usda('Lamb, Australian, imported, fresh, external fat, cooked', {
      kcalPer100g: 554,
    });
    assert.equal(pickBestMatch({ nameEn: 'lamb', preparation: 'boiled' }, [fat]), null);
  });

  test('компоненты бургера не считаются другим продуктом', () => {
    // На «cheeseburger» отбраковывались все кандидаты из-за слова «patty»,
    // хотя котлета — часть бургера, а не замена ему
    const burger = usda('Fast foods, cheeseburger; single, regular patty; plain', {
      kcalPer100g: 308,
    });
    assert.equal(pickBestMatch({ nameEn: 'cheeseburger' }, [burger]), burger);
  });

  test('булочка для бургера находится', () => {
    // `Roll` здесь категория, как `Beverages` у напитков
    const bun = usda('Roll, white, hamburger bun', { kcalPer100g: 267 });
    assert.equal(pickBestMatch({ nameEn: 'hamburger bun' }, [bun]), bun);
  });

  test('послабление для готовых блюд не распространяется на продукты', () => {
    // Правило снимает проверку форм только когда запрос сам про изделие:
    // «apple» изделием не является, и пирог ему не ответит
    assert.equal(pickBestMatch({ nameEn: 'apple' }, [usda('Pie, apple')]), null);
  });
});

/**
 * Напитки — вторая половина случая из живого дневника: «Кола Зеро» и «Кофе
 * с молоком» тоже ушли в день без калорий. В номенклатуре USDA они пишутся
 * через «Soft drink» и «Beverages», и слово «drink» браковало их как другую
 * форму продукта.
 */
describe('Напитки', () => {
  test('жидкая форма не мешает найти напиток', () => {
    const cola = usda('Soft drink, cola', { kcalPer100g: 42 });
    assert.equal(pickBestMatch({ nameEn: 'cola' }, [cola]), cola);
  });

  test('растворимый порошок не отвечает на запрос про напиток', () => {
    // 345 ккал/100 г против единицы у заваренного — ошибка в триста раз.
    // Послабление для напитков снимает только жидкие формы, не концентраты
    const instant = usda('Beverages, tea, instant, lemon, unsweetened', {
      kcalPer100g: 345,
    });
    assert.equal(pickBestMatch({ nameEn: 'tea' }, [instant]), null);
  });

  test('ликёр не отвечает на запрос про кофе', () => {
    // 336 ккал вместо двух: пока алкоголь не попал в список форм, ликёр
    // проходил как «кофе с уточнением»
    const liqueur = usda('Alcoholic beverage, liqueur, coffee, 53 proof', {
      kcalPer100g: 336,
    });
    assert.equal(pickBestMatch({ nameEn: 'coffee' }, [liqueur]), null);
  });

  test('малая абсолютная разница отказа не вызывает', () => {
    // Заваренный кофе 1 ккал против эспрессо 9 — это 89% расхождения
    // и восемь килокалорий. Отказ здесь стоил бы дороже выбора
    const brewed = usda('Beverages, coffee, brewed, prepared with tap water', {
      kcalPer100g: 1,
    });
    const espresso = usda('Beverages, coffee, brewed, espresso, restaurant-prepared', {
      kcalPer100g: 9,
    });
    assert.notEqual(pickBestMatch({ nameEn: 'coffee' }, [brewed, espresso]), null);
  });
});
