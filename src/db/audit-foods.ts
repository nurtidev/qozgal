import { env } from '@/env';
import { searchUsda } from '@/lib/nutrition/usda';
import { KAZAKH_FOODS } from './seed-data/kazakh-foods';

/**
 * Сверка справочника местной кухни с авторитетными данными USDA.
 *
 * Зачем: 22 карточки заведены расчётными оценками по типовым рецептурам
 * (см. шапку seed-data/kazakh-foods.ts) и помечены isVerified: false.
 * Ошибка в них не видна: неверная цифра выглядит ровно как верная и молча
 * смещает дневной итог.
 *
 * Что этот скрипт делает и чего не делает:
 *
 *  — сравнивает нашу карточку с ближайшим документированным аналогом из
 *    наборов Foundation и SR Legacy. Это лабораторные измерения Минсельхоза
 *    США, а не пользовательские данные и не этикетки производителей;
 *  — НЕ пересчитывает блюдо от рецептуры. Пропорции мяса, теста и жира
 *    пришлось бы задать самим, и результат был бы такой же оценкой, только
 *    полученной другим путём — сравнивать оценку с оценкой бессмысленно;
 *  — НЕ меняет ни одной цифры в справочнике и не ставит isVerified.
 *    Аналог — это повод проверить карточку, а не основание её заменить:
 *    у казы и жента прямого аналога нет в принципе.
 *
 * Итог — список карточек, отсортированный по расхождению: с них и стоит
 * начинать сверку по таблицам химического состава.
 *
 * Запуск: node --env-file=.env node_modules/.bin/tsx src/db/audit-foods.ts
 */

interface Analogue {
  /** Что искать в USDA. Несколько запросов — берём лучшее совпадение */
  queries: string[];
  /** Почему именно этот аналог и чем он отличается от нашего блюда */
  note: string;
}

/**
 * Сырое и несваренное в сравнение не годится.
 *
 * USDA охотно отдаёт на «lamb stew» сырой фарш, а на «rice pilaf» — сухую
 * смесь из пачки. У сухого продукта на 100 г втрое больше калорий, чем
 * у сваренного, и такое «расхождение» говорит только о том, что сравнили
 * несравнимое.
 */
const NOT_COMPARABLE = /\braw\b|unprepared|dry mix|, dry\b|babyfood/i;

/**
 * Аналоги подобраны вручную по составу, а не по названию: «samsa» в USDA
 * не найдётся, но печёный пирожок с мясом и луком — это beef pot pie.
 * Где аналога нет, стоит null: молчание честнее натянутого сходства.
 */
const ANALOGUES: Record<string, Analogue | null> = {
  /* Продукты с прямым эквивалентом — их и проверяем */

  'kz-sarymai': {
    queries: ['butter oil anhydrous', 'ghee butter'],
    note: 'топлёное масло и ghee — один и тот же продукт',
  },
  'kz-tandyr-nan': {
    queries: ['bread pita white', 'bread naan'],
    note: 'пресная печёная лепёшка из муки и воды',
  },
  'kz-shuzhyk': {
    queries: ['summer sausage beef', 'sausage cervelat'],
    note: 'вяленая колбаса; у нашей конина вместо говядины',
  },
  'kz-talkan': {
    queries: ['wheat flour whole grain', 'barley flour'],
    note: 'молотое зерно; обжарка калорийность почти не меняет',
  },
  'kz-ayran': {
    queries: ['buttermilk cultured', 'yogurt plain whole milk'],
    note: 'кисломолочный напиток; жирность зависит от молока',
  },

  /*
   * Составные блюда этим методом не проверяются.
   *
   * В USDA нет ни бешбармака, ни куырдака, а поиск по описанию отдаёт то
   * варёную рисовую лапшу без мяса, то кубик бульона, разведённый водой.
   * Расхождение с таким «аналогом» говорит о том, что сравнили несравнимое,
   * а не о том, что карточка неверна. Их путь — таблицы химического состава
   * либо пересчёт от рецептуры, и то и другое требует источника, которого
   * у скрипта нет.
   */
  'kz-beshbarmak': null,
  'kz-kuyrdak': null,
  'kz-kazy': null,
  'kz-sorpa': null,
  'kz-asyp': null,
  'kz-baursak': null,
  'kz-shelpek': null,
  'kz-manty': null,
  'kz-samsa': null,
  'kz-lagman': null,
  'kz-plov': null,

  /*
   * Национальные молочные продукты: кумыс, шубат, курт, иримшик, жент.
   * Их в номенклатуре USDA нет вовсе, а обезжиренный сухой творог — другой
   * продукт по жирности и влажности.
   */
  'kz-kurt': null,
  'kz-shubat': null,
  'kz-kumys': null,
  'kz-irimshik': null,
  'kz-zhent': null,
};

const percent = (ours: number, theirs: number) =>
  Math.round(((ours - theirs) / theirs) * 1000) / 10;

async function main() {
  if (!env.USDA_API_KEY) {
    console.error('Нужен USDA_API_KEY: сверять не с чем');
    process.exit(2);
  }

  const rows: {
    name: string;
    ours: number;
    theirs: number | null;
    match: string;
    delta: number | null;
    note: string;
  }[] = [];

  for (const food of KAZAKH_FOODS) {
    const analogue = ANALOGUES[food.externalId ?? ''];

    if (!analogue) {
      rows.push({
        name: food.nameRu,
        ours: food.kcalPer100g,
        theirs: null,
        match: '—',
        delta: null,
        note: 'прямого эквивалента нет — только таблицы состава',
      });
      continue;
    }

    let best: { kcal: number; name: string } | null = null;

    for (const query of analogue.queries) {
      const found = await searchUsda(query, env.USDA_API_KEY, { limit: 5 });
      // Только лабораторные наборы: у брендовых записей числа с этикетки
      const verified = found.filter(
        (p) =>
          p.isVerified &&
          p.kcalPer100g > 0 &&
          !NOT_COMPARABLE.test(p.nameEn ?? ''),
      );
      if (verified.length > 0) {
        best = { kcal: verified[0].kcalPer100g, name: verified[0].nameEn ?? query };
        break;
      }
    }

    rows.push({
      name: food.nameRu,
      ours: food.kcalPer100g,
      theirs: best?.kcal ?? null,
      match: best?.name ?? 'не нашлось',
      delta: best ? percent(food.kcalPer100g, best.kcal) : null,
      note: analogue.note,
    });
  }

  // Самое большое расхождение вверху: с него и начинать сверку
  rows.sort((a, b) => Math.abs(b.delta ?? -1) - Math.abs(a.delta ?? -1));

  console.log('\nСверка справочника местной кухни с USDA (Foundation + SR Legacy)');
  console.log('Отрицательное расхождение — наша цифра ниже эквивалента.\n');

  for (const row of rows) {
    const ours = String(row.ours).padStart(4);
    const theirs = row.theirs === null ? '   —' : String(row.theirs).padStart(4);
    const delta =
      row.delta === null ? '     ' : `${row.delta > 0 ? '+' : ''}${row.delta}%`.padStart(7);
    console.log(`${row.name.padEnd(26)} ${ours} → ${theirs} ${delta}  ${row.match}`);
    console.log(`${' '.repeat(26)} ${row.note}`);
  }

  const checked = rows.filter((r) => r.delta !== null);
  const bad = checked.filter((r) => Math.abs(r.delta!) >= 25);

  console.log(
    `\nПроверено ${checked.length} из ${rows.length}, ` +
      `расходятся сильнее чем на 25%: ${bad.length}.`,
  );
  console.log(
    'Остальные карточки — составные блюда и национальные молочные продукты.\n' +
      'Прямого эквивалента у них в USDA нет, и подстановка похожего по названию\n' +
      'даёт не проверку, а иллюзию проверки. Им нужен источник посерьёзнее:\n' +
      'таблицы химического состава либо пересчёт от рецептуры.',
  );

  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
