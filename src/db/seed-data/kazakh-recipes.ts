import type { Preparation } from '@/lib/ai/schemas';

/**
 * Из чего состоят 100 граммов готового блюда.
 *
 * Зачем это здесь. Калорийность 22 карточек местной кухни — расчётные
 * оценки (см. шапку kazakh-foods.ts), и главная беда не в самой погрешности,
 * а в том, что цифра ничем не подкреплена: проверить её нельзя, поправить
 * тоже — непонятно, что именно менять. Состав делает оценку разбираемой:
 * видно, сколько в блюде мяса, сколько теста и сколько масла, и спорить
 * можно об этих числах, а не о готовом итоге.
 *
 * ⚠️ Это по-прежнему оценка, а не измерение. Рецептуры типовые, источник —
 * общее описание блюд, а не сборник рецептур и не лаборатория. Поэтому
 * `isVerified` у карточек остаётся false, а скрипт `npm run audit:recipes`
 * ничего не переписывает сам: он показывает, насколько расчёт от состава
 * расходится с тем, что стоит в карточке, и с чего начинать проверку.
 *
 * Модель одна для всех блюд: доли компонентов и воды в сумме дают 100 г.
 *  — для варёного берутся ГОТОВЫЕ компоненты (отварное мясо, отварное тесто):
 *    вода в них уже есть, и складывать её отдельно не нужно;
 *  — для печёного и жареного берутся СУХИЕ (мука, масло, сахар), а остаток
 *    до 100 г — вода. Так не нужны коэффициенты уварки: единственное
 *    допущение — пропорции на тарелке, а они видны и обсуждаемы.
 *
 * Национальные молочные продукты (курт, иримшик, шубат, кумыс) состава
 * не имеют: разложить их на компоненты нельзя, там сквашивание и сушка,
 * а не смешивание. Их проверять только по таблицам или измерением.
 */

export interface RecipeComponent {
  /** Что искать в справочнике и USDA */
  nameEn: string;
  /** Как приготовлено — от этого зависит, какую карточку найдёт отбор */
  preparation?: Preparation;
  /** Граммов на 100 г готового блюда */
  grams: number;
  /** Чем обосновано именно это число */
  note?: string;
}

export interface Recipe {
  /** externalId карточки в kazakh-foods.ts */
  externalId: string;
  components: RecipeComponent[];
  /** Вода и всё, что не несёт калорий: остаток до 100 г */
  waterG: number;
  /** Что в этой рецептуре самое спорное — там и искать причину расхождения */
  weakest: string;
}

export const KAZAKH_RECIPES: Recipe[] = [
  {
    externalId: 'kz-beshbarmak',
    components: [
      { nameEn: 'lamb', preparation: 'boiled', grams: 32, note: 'мясо с костью подаётся, но в тарелку идёт без неё' },
      { nameEn: 'noodles', preparation: 'boiled', grams: 48, note: 'основа блюда — отварное тесто' },
      { nameEn: 'onion', preparation: 'boiled', grams: 8 },
    ],
    waterG: 12,
    weakest:
      'жирность мяса: конина и баранина различаются вдвое, а курдючный жир добавляют не везде',
  },
  {
    externalId: 'kz-kuyrdak',
    components: [
      { nameEn: 'lamb', preparation: 'fried', grams: 42 },
      { nameEn: 'potato', preparation: 'fried', grams: 30 },
      { nameEn: 'onion', preparation: 'fried', grams: 10 },
      { nameEn: 'butter oil anhydrous', grams: 5, note: 'курдючный жир; берём топлёное масло — животные жиры по калорийности почти не различаются' },
    ],
    waterG: 13,
    weakest:
      'доля потрохов: на печени и лёгком блюдо выходит легче, чем на мясе с жиром',
  },
  {
    externalId: 'kz-sorpa',
    components: [
      { nameEn: 'butter oil anhydrous', grams: 3, note: 'жир, снявшийся с мяса при варке' },
      { nameEn: 'lamb', preparation: 'boiled', grams: 4, note: 'мелкие частицы мяса и белок бульона' },
    ],
    waterG: 93,
    weakest: 'сколько жира снято перед подачей — расхождение здесь двукратное',
  },
  {
    externalId: 'kz-asyp',
    components: [
      { nameEn: 'rice', preparation: 'boiled', grams: 40 },
      { nameEn: 'butter oil anhydrous', grams: 12, note: 'курдючный жир начинки' },
      { nameEn: 'lamb', preparation: 'boiled', grams: 8, note: 'потроха и мясная обрезь' },
      { nameEn: 'onion', preparation: 'boiled', grams: 5 },
    ],
    waterG: 35,
    weakest: 'количество жира в начинке',
  },
  {
    externalId: 'kz-baursak',
    components: [
      { nameEn: 'wheat flour', grams: 50 },
      { nameEn: 'sunflower oil', grams: 12, note: 'впитавшееся при жарке во фритюре' },
      { nameEn: 'sugar', grams: 2 },
    ],
    waterG: 36,
    weakest:
      'сколько масла впитало тесто: зависит от температуры фритюра сильнее, чем от рецепта',
  },
  {
    externalId: 'kz-shelpek',
    components: [
      { nameEn: 'wheat flour', grams: 52 },
      { nameEn: 'sunflower oil', grams: 9, note: 'лепёшка тоньше баурсака и берёт меньше масла' },
    ],
    waterG: 39,
    weakest: 'толщина лепёшки, от неё зависит доля масла',
  },
  {
    externalId: 'kz-manty',
    components: [
      { nameEn: 'noodles', preparation: 'boiled', grams: 48, note: 'тесто на пару близко к отварному' },
      { nameEn: 'lamb', preparation: 'boiled', grams: 32, note: 'фарш готовится на пару вместе с тестом' },
      { nameEn: 'onion', preparation: 'boiled', grams: 10 },
      { nameEn: 'butter oil anhydrous', grams: 4, note: 'в фарш добавляют курдючный жир, иначе он сухой' },
    ],
    waterG: 6,
    weakest: 'соотношение теста и фарша: у разных хозяек оно расходится вдвое',
  },
  {
    externalId: 'kz-samsa',
    components: [
      { nameEn: 'wheat flour', grams: 38 },
      { nameEn: 'sunflower oil', grams: 8, note: 'слоёное тесто промазывают маслом' },
      { nameEn: 'lamb', preparation: 'baked', grams: 28 },
      { nameEn: 'onion', preparation: 'baked', grams: 6 },
    ],
    waterG: 20,
    weakest: 'тесто слоёное или пресное — разница в масле почти двукратная',
  },
  {
    externalId: 'kz-lagman',
    components: [
      { nameEn: 'noodles', preparation: 'boiled', grams: 45 },
      { nameEn: 'lamb', preparation: 'fried', grams: 12 },
      { nameEn: 'pepper', preparation: 'fried', grams: 10, note: 'болгарский перец' },
      { nameEn: 'tomato', preparation: 'stewed', grams: 8, note: 'в подливе томат тушится' },
      { nameEn: 'onion', preparation: 'fried', grams: 5 },
      { nameEn: 'sunflower oil', grams: 3 },
    ],
    waterG: 17,
    weakest: 'сколько подливы в тарелке — от этого зависит всё остальное',
  },
  {
    externalId: 'kz-plov',
    components: [
      { nameEn: 'rice', preparation: 'boiled', grams: 55 },
      { nameEn: 'lamb', preparation: 'fried', grams: 15 },
      { nameEn: 'carrot', preparation: 'stewed', grams: 12, note: 'морковь тушится в жире вместе с рисом' },
      { nameEn: 'butter oil anhydrous', grams: 8, note: 'плов делают на курдючном жире или растительном масле' },
      { nameEn: 'onion', preparation: 'fried', grams: 5 },
    ],
    waterG: 5,
    weakest: 'количество жира: на нём и держится разница между 180 и 250 ккал',
  },
  {
    externalId: 'kz-zhent',
    components: [
      { nameEn: 'millet', grams: 42, note: 'талкан — молотое обжаренное просо или пшеница' },
      { nameEn: 'sugar', grams: 20 },
      { nameEn: 'butter oil anhydrous', grams: 20, note: 'топлёное масло' },
      { nameEn: 'cottage cheese', grams: 10, note: 'сушёный творог, иримшик' },
    ],
    waterG: 8,
    weakest: 'доля масла и сахара — блюдо готовят «на глаз»',
  },
  {
    externalId: 'kz-milk-tea',
    components: [
      { nameEn: 'whole milk', grams: 25, note: 'молоко в чай льют щедро' },
      { nameEn: 'sugar', grams: 1 },
    ],
    waterG: 74,
    weakest: 'доля молока и наличие сахара — в разных домах по-разному',
  },
];
