import type { NewProduct } from '@/db/schema';
import type { Preparation } from '@/lib/ai/schemas';

/**
 * Выбор карточки USDA под запрос модели.
 *
 * Появился из-за случая, ради которого построено всё приложение: на «apple»
 * поиск USDA первым отдавал `Rose-apples, raw` — 25 ккал/100 г вместо 52
 * у обычного яблока. Карточка уходила в кеш и с тех пор занижала каждый
 * день с яблоком вдвое, оставаясь при этом правдоподобным числом.
 *
 * Причина была не в ранжировании USDA, а в его отсутствии у нас: резолвер
 * запрашивал один результат и брал его как есть.
 *
 * Здесь только суждение о соответствии, без сети — поэтому проверяется
 * юнит-тестами на реальных строках USDA.
 */

/* ──────────────────────────── Словари ─────────────────────────────── */

/**
 * Служебные слова номенклатуры USDA: ни имя продукта, ни шум.
 *
 * `NFS` и `NS` — «not further specified» и «not specified», пометки
 * составителей; `USDA commodity` — линейка школьного питания.
 */
const STOP_WORDS = [
  'with', 'without', 'and', 'or', 'of', 'in', 'on', 'the', 'a', 'as', 'to',
  'from', 'for', 'nfs', 'ns', 'includes', 'usda', 'commodity', 'type', 'form',
  'all', 'any', 'each', 'per', 'other', 'than', 'more', 'less', 'not',
  'specified', 'unspecified', 'only', 'approx', 'average', 'year', 'round',
];

/**
 * Слова, уточняющие продукт, но не меняющие его тождества.
 *
 * Отсутствие такого слова в описании — не повод отбраковать кандидата,
 * а его присутствие не считается лишним словом. Список намеренно широкий:
 * описания USDA состоят из таких уточнений на две трети, и без словаря
 * любое подробное описание проигрывало бы короткому только за длину.
 */
const MODIFIER_WORDS = [
  // товарный вид и обработка
  'canned', 'frozen', 'fresh', 'chilled', 'refrigerated', 'bottled', 'packaged',
  'reconstituted', 'enriched', 'unenriched', 'fortified',
  'pasteurized', 'sterilized', 'prepared', 'heated', 'reheated', 'purchased',
  // помол и нарезка
  'ground', 'chopped', 'sliced', 'diced', 'shredded', 'grated', 'crushed',
  'mashed', 'pureed', 'whole', 'half', 'halves', 'piece', 'pieces', 'cut',
  'flake', 'flakes',
  // количество котлет или слоёв — уточнение, а не другой продукт
  'single', 'double', 'triple',
  // части и очистка
  'peeled', 'unpeeled', 'skin', 'skinless', 'boneless', 'bone', 'bones',
  'cored', 'pitted', 'seedless', 'drained', 'undrained', 'solid', 'solids',
  'liquid', 'flesh', 'edible', 'portion', 'portions', 'trimmed', 'untrimmed',
  // добавки и жирность
  'added', 'salt', 'salted', 'unsalted', 'sweetened', 'unsweetened', 'sugar',
  'water', 'oil', 'fat', 'lowfat', 'nonfat', 'reduced', 'lean', 'light',
  'lite', 'regular', 'plain', 'sodium', 'vitamin', 'vitamins', 'calcium',
  // происхождение приготовления
  'homemade', 'restaurant', 'prepackaged', 'store', 'bought', 'made',
];

/**
 * Состояние продукта. Отделено от прочих модификаторов, потому что
 * несоответствие здесь даёт кратную ошибку, а не процентную: сухая гречка
 * 343 ккал/100 г против варёной 92.
 *
 * Слова про сушку сюда не входят намеренно — сушёное яблоко это не «яблоко
 * в состоянии raw», а другой продукт: 243 ккал против 61. Они в PROCESSED_FORMS.
 */
const RAW_WORDS = ['raw', 'uncooked', 'unprepared'];
const COOKED_WORDS = [
  'cooked', 'boiled', 'fried', 'fries', 'baked', 'roasted', 'grilled',
  'broiled', 'steamed', 'stewed', 'braised', 'sauteed', 'poached',
  'microwaved', 'toasted', 'rotisserie', 'simmered', 'barbecued', 'smoked',
  'brewed',
];

/**
 * Формы, в которых продукт перестаёт быть собой.
 *
 * Отбраковывают кандидата, если запрос о них не просил. Список появился
 * прямо из живой выдачи (`npm run probe:usda`): на «apple» USDA отдавала
 * `Croissants, apple` (254 ккал), `Pie, apple` (296), `Apple, dried` (243)
 * и `Apple, candied` (134) — то есть яблоко как начинку и как сухофрукт.
 * Все они формально содержат слово «apple», и без этого списка одно из них
 * выигрывало у настоящего яблока на 61 ккал.
 *
 * Расчёт на то, что модель, увидев на снимке пирог, назовёт его пирогом:
 * тогда слово окажется в запросе, и отбраковка не сработает.
 */
const PROCESSED_FORMS = [
  // выпечка и десерты
  'pie', 'cake', 'cookie', 'cookies', 'wafer', 'croissant', 'croissants',
  'strudel', 'cobbler', 'crisp', 'pudding', 'dessert', 'pastry', 'muffin',
  'doughnut', 'brownie', 'candy', 'candies', 'candied', 'glazed', 'frosting',
  // снеки и батончики
  'chips', 'crackers', 'snack', 'snacks', 'bar', 'bars', 'popcorn', 'breaded',
  // напитки и жидкие формы
  // «beverage» и «beverages» сюда не входят: в USDA это название группы
  // (`Beverages, coffee, brewed`), а не признак другого продукта
  'juice', 'cider', 'nectar', 'drink', 'smoothie',
  'shake', 'syrup', 'syrups', 'jam', 'jelly', 'marmalade', 'preserves',
  // концентраты и сушёное
  'dried', 'dehydrated', 'dry', 'powder', 'powdered', 'concentrate',
  'concentrated', 'evaporated', 'condensed', 'extract', 'flour', 'meal',
  'sweetened',
  // «instant» у напитков означает порошок: растворимый чай — 345 ккал/100 г
  // против единицы у заваренного
  'instant',
  // готовые блюда
  'sandwich', 'burger', 'pizza', 'soup', 'sauce', 'gravy', 'salad', 'dressing',
  'casserole', 'entree', 'roll', 'wrap', 'nuggets', 'patty', 'sausage',
  // особое питание
  'babyfood', 'infant', 'formula', 'toddler', 'junior', 'strained',
  /**
   * Алкоголь. На «coffee» USDA отдавала `Alcoholic beverage, liqueur,
   * coffee, 53 proof` — 336 ккал вместо двух у кофе, и до этого списка
   * ликёр проходил как «кофе с уточнением».
   */
  'liqueur', 'alcoholic', 'wine', 'beer', 'vodka', 'whiskey', 'whisky',
  'rum', 'brandy', 'gin', 'tequila', 'cocktail', 'liquor', 'ale', 'cider',
];

/**
 * Форма зерна — часть имени продукта, а не примесь к нему.
 *
 * `Buckwheat groats` это гречка, `Wheat kernels` — пшеница. Слова стоят
 * отдельным списком, потому что при оценке имени они должны быть
 * прозрачны: иначе единственная карточка варёной гречки получала штраф
 * за «groats» и отбрасывалась, а вместо неё выигрывало сухое зерно
 * с 343 ккал против 92.
 */
const GRAIN_FORMS = ['groats', 'grain', 'grains', 'kernel', 'kernels', 'germ'];

/**
 * Части продукта, которые сами по себе едой не бывают.
 *
 * USDA заводит на них отдельные строки, и по названию они неотличимы от
 * самого продукта: на «варёная картошка» лучшим кандидатом оказалась
 * `Potatoes, boiled, cooked in skin, skin, with salt` — это кожура, 78 ккал
 * против 87 у мякоти, здесь почти безобидно. А на «варёная баранина» —
 * `Lamb, Australian, imported, fresh, seam fat, cooked`, то есть жир
 * с туши: 554 ккал вместо 190, втрое.
 *
 * Различать приходится по строению сегмента: «with skin» у яблока — это
 * уточнение (яблоко с кожурой), а отдельный сегмент «skin» — это сама
 * кожура. Поэтому проверяется не наличие слова, а то, что сегмент состоит
 * из таких слов целиком и не начинается с предлога.
 */
const PART_WORDS = [
  'skin', 'fat', 'bone', 'bones', 'rind', 'seam', 'gristle', 'marrow',
  'peel', 'shell', 'husk', 'core', 'pit', 'stem', 'trimmings', 'fatback',
  'tallow', 'suet', 'giblets',
  /**
   * Субпродукты. Их едят, и в местной кухне тоже, но ответом на «говядина»
   * они быть не могут: на этот запрос USDA отдавала `Beef, variety meats
   * and by-products, brain, cooked, simmered`. Если модель узнала на снимке
   * печень, слово окажется в запросе и отбраковка не сработает.
   */
  'brain', 'liver', 'kidney', 'kidneys', 'tongue', 'tripe', 'heart', 'lung',
  'lungs', 'spleen', 'thymus', 'sweetbread', 'pancreas', 'blood', 'feet',
  'testes', 'testicles', 'brains', 'tripes', 'chitterlings', 'mesentery',
];

/**
 * Категории номенклатуры USDA. Стоят первым сегментом и не означают, что
 * продукт другой: `Beverages, coffee, brewed` — это кофе, а не «напиток
 * со вкусом кофе».
 *
 * Отличие от `Croissants, apple`, где первым сегментом стоит настоящий
 * продукт, лексически неразличимо — поэтому список закрытый.
 */
const CATEGORY_WORDS = [
  'beverages', 'beverage', 'fast', 'foods', 'food', 'restaurant', 'cereals',
  'cereal', 'spices', 'herbs', 'nuts', 'seeds', 'fish', 'shellfish',
  'finfish', 'vegetables', 'fruits', 'legumes', 'poultry',
  'luncheon', 'meats', 'meat', 'dairy', 'products', 'grains', 'pasta',
  'fats', 'oils', 'oil', 'school', 'lunch', 'entrees', 'meals',
  /**
   * «Roll» в номенклатуре булочек играет ту же роль, что «Beverages»
   * у напитков: `Roll, white, hamburger bun` — это булочка для бургера,
   * а не «рулет с булочкой». Без этого разложение бургера теряло булочку,
   * а с ней и покрытие, при котором блюдо вообще считается.
   */
  'roll', 'rolls', 'bun', 'buns',
  // «Soft drink, cola» — структура «категория, вид», как у булочек
  'soft', 'drink', 'drinks',
  // `Coffee, Latte`, `Tea, green` — структура «категория, вид»
  'coffee', 'tea',
  // `Beverages, carbonated, cola, regular` — способ подачи, не продукт
  'carbonated',
];

/* ─────────────────────────── Токенизация ──────────────────────────── */

/**
 * Грубое приведение к единственному числу.
 *
 * Правила заведомо неточные («couscous» станет «couscou»), и это безопасно:
 * нормализация применяется к обеим сторонам сравнения, поэтому одинаково
 * искажённые формы всё равно совпадают. Нужна она ради «apple» против
 * `Apples, raw` — без неё головное слово описания не опознавалось.
 */
function singular(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 4 && /(ch|sh|ss|x|z|o)es$/.test(token)) {
    return token.slice(0, -2);
  }
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

/** Слова строки в нормализованном виде; числа отбрасываются */
function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !/^\d+$/.test(token))
    .map(singular);
}

const STOP = new Set(STOP_WORDS.map(singular));
const MODIFIERS = new Set(MODIFIER_WORDS.map(singular));
const RAW = new Set(RAW_WORDS.map(singular));
const COOKED = new Set(COOKED_WORDS.map(singular));
const PROCESSED = new Set(PROCESSED_FORMS.map(singular));
const CATEGORIES = new Set(CATEGORY_WORDS.map(singular));
const PARTS = new Set(PART_WORDS.map(singular));

/** Предлоги, после которых слово читается как уточнение, а не как продукт */
const QUALIFYING_PREPOSITIONS = new Set(['with', 'without', 'in']);

/** Слова, переворачивающие смысл следующего за ними: «not reheated» */
const NEGATIONS = new Set(['not', 'no', 'without', 'un']);

/**
 * Есть ли в описании слово из набора, не под отрицанием.
 *
 * Нужно из-за строки `Chicken, nuggets, white meat, precooked, frozen,
 * not reheated`: слово «not» служебное и выбрасывается при токенизации,
 * поэтому «not reheated» читалось как подтверждение готовности — и
 * замороженный полуфабрикат (261 ккал) выигрывал у готовых наггетсов (307).
 */
function affirms(tokens: string[], words: Set<string>): boolean {
  return tokens.some(
    (token, index) =>
      words.has(token) && !(index > 0 && NEGATIONS.has(tokens[index - 1])),
  );
}

const GRAINS = new Set(GRAIN_FORMS.map(singular));

/** Уточняющее слово: модификатор либо состояние */
function isModifier(token: string): boolean {
  return (
    MODIFIERS.has(token) ||
    RAW.has(token) ||
    COOKED.has(token) ||
    GRAINS.has(token)
  );
}

/** Слово, несущее тождество продукта */
function isCore(token: string): boolean {
  return !STOP.has(token) && !isModifier(token);
}

/**
 * Слово, которое не считается примесью в имени продукта ни при каких
 * условиях: служебное, о состоянии или о форме зерна.
 */
function isTransparent(token: string): boolean {
  return (
    STOP.has(token) ||
    RAW.has(token) ||
    COOKED.has(token) ||
    GENERIC_COOKED.has(token) ||
    GRAINS.has(token)
  );
}

/**
 * Как USDA называет тот же способ приготовления, что и модель.
 *
 * Различать способы, а не только «сырое против готового», приходится
 * из-за живой выдачи: на «жареная картошка» лучшим кандидатом оказались
 * `Stewed potatoes` (103 ккал) — тушёное тоже готовое, и грубая проверка
 * состояния считала это совпадением. Настоящий ответ — `Potato, french
 * fries, from fresh, fried` (198 ккал), вдвое дороже.
 */
const PREPARATION_WORDS: Record<Exclude<Preparation, 'unknown'>, string[]> = {
  raw: ['raw', 'uncooked', 'unprepared'],
  boiled: ['boiled', 'simmered', 'poached'],
  fried: ['fried', 'fries', 'sauteed'],
  baked: ['baked', 'roasted', 'oven'],
  grilled: ['grilled', 'broiled', 'barbecued'],
  steamed: ['steamed'],
  stewed: ['stewed', 'braised'],
};

/**
 * Слова о готовности без указания способа. В номенклатуре USDA это чаще
 * всего и есть нужное состояние: `Buckwheat groats, roasted, cooked` —
 * обжаренная крупа, которую сварили, и «roasted» здесь про сорт, а не
 * про то, что с ней сделали перед едой.
 */
const GENERIC_COOKED = new Set(['cooked', 'prepared', 'heated', 'reheated']);

/**
 * Готовые изделия: продукты, у которых способ приготовления уже внутри
 * названия.
 *
 * Спрашивать у такой карточки, жареная она или варёная, бессмысленно —
 * сырых наггетсов не едят, и жир от фритюра посчитан в самой строке.
 * А проверка состояния на них ломалась: модель называет наггетсы жареными
 * (так и есть), в описаниях USDA слова «fried» нет ни у одного варианта
 * (`Chicken nuggets, NFS`, `from fast food`, `precooked, frozen`), и все
 * 127 кандидатов отбраковывались. Позиция уходила в ручной ввод, а день
 * оставался с нулём — при том что нужные 307 ккал/100 г в базе есть.
 *
 * Слова взяты из PROCESSED_FORMS: там они означают «другой продукт»,
 * если их нет в запросе, а здесь — «продукт уже приготовлен», если есть.
 */
/**
 * Составные блюда: их название целиком описывает готовое изделие, а описание
 * в USDA перечисляет компоненты. Проверяются подстрокой, потому что
 * «cheeseburger» и «hamburger» — одно слово каждое.
 */
const COMPOSED_DISHES = ['burger', 'sandwich', 'pizza', 'burrito', 'taco', 'hotdog', 'shawarma', 'doner'];

/**
 * Напитки — та же история, что с бургерами. В номенклатуре USDA они пишутся
 * через «Soft drink», «Beverages, carbonated», и слово «drink» браковало их
 * как «другую форму продукта»: на «cola» не находилось ничего, хотя
 * `Soft drink, cola` — это она и есть. Когда запрос сам про напиток,
 * проверка форм не нужна: жидкая форма и есть искомая.
 */
/** Слова жидкой формы: для напитка это и есть искомое, а не подмена */
const LIQUID_FORMS = new Set(['drink', 'drinks', 'soda', 'beverage', 'beverages']);

const DRINK_WORDS = new Set(
  [
    'cola', 'coffee', 'tea', 'latte', 'cappuccino', 'americano', 'espresso',
    'lemonade', 'soda', 'kefir', 'ayran', 'kumys', 'shubat', 'compote',
    'kvass', 'smoothie', 'juice', 'cocoa', 'milkshake',
  ].map(singular),
);

const READY_FORMS = new Set(
  [
    'nuggets', 'fries', 'chips', 'pie', 'cake', 'cookie', 'cookies', 'wafer',
    'croissant', 'croissants', 'doughnut', 'muffin', 'pastry', 'brownie',
    'patty', 'sandwich', 'burger', 'pizza', 'wrap', 'roll', 'popcorn',
    'crackers', 'sausage', 'strudel', 'cobbler',
  ].map(singular),
);

const PREPARATION = Object.fromEntries(
  Object.entries(PREPARATION_WORDS).map(([key, words]) => [
    key,
    new Set(words.map(singular)),
  ]),
) as Record<Exclude<Preparation, 'unknown'>, Set<string>>;

/**
 * Все слова о способе приготовления — чтобы заметить чужой способ.
 *
 * Берутся не только те, что соответствуют нашим семи значениям: в USDA
 * есть `microwaved`, `smoked`, `rotisserie`, и на «жареная картошка»
 * микроволновая (132 ккал) выигрывала у настоящей жареной (198), потому
 * что её способ не считался чужим — он просто не был нам известен.
 */
const ANY_METHOD = new Set(
  [...Object.values(PREPARATION_WORDS).flat(), ...COOKED_WORDS]
    .map(singular)
    .filter((word) => !GENERIC_COOKED.has(word)),
);

/* ──────────────────────────── Оценка ──────────────────────────────── */

/**
 * Веса подобраны на живой выдаче USDA (`npm run probe:usda`) и держат
 * два решения:
 *
 *  — чистое имя перебивает длину описания, поэтому `Apples, raw, with skin`
 *    выигрывает у `Rose-apples, raw`, где к совпавшему слову приклеено
 *    лишнее;
 *  — подтверждённое состояние перебивает чистое имя, поэтому на «варёная
 *    гречка» выигрывает `Buckwheat groats, roasted, cooked`, а не короткое
 *    `Buckwheat`, которое означает сухое зерно.
 */
const WEIGHTS = {
  /** Прошёл проверки на тождество продукта — уже кое-что */
  base: 1,
  /**
   * Лабораторное измерение (Foundation, SR Legacy), а не усреднённое блюдо.
   *
   * Вес небольшой намеренно. Он стоял вдвое выше, и на «apple» это давало
   * перевес карточке `Croissants, apple` из SR Legacy над простой строкой
   * `Apple, raw` из набора Survey: доверие к методике перевешивало то, что
   * речь о разных продуктах.
   */
  reliable: 0.5,
  /** Совпал уточняющий признак: `whole` в запросе и в описании */
  modifier: 0.5,
  /** Описание называет тот же способ приготовления */
  methodMatch: 2,
  /** Описание подтверждает готовность, но способ не называет */
  methodGeneric: 1.5,
  /** Описание называет другой способ: просили жареное, нашлось тушёное */
  methodOther: -1,
  /** Состояние заявлено, описание о нём молчит */
  stateUnconfirmed: -1.5,
  /** Описание прямо противоречит: просили жареное, нашлось сырое */
  stateConflict: -2.5,
  /**
   * Приготовленное в ответ на запрос без указания способа.
   *
   * Модель говорит `unknown` в основном про необработанное — фрукт, овощ,
   * хлеб. На «apple» иначе выигрывало `Apple, baked` (113 ккал против 61).
   */
  unaskedCooking: -0.5,
  /** Замороженная заготовка там, где способ приготовления не назван */
  frozenBlank: -1,
  /** Лишнее значимое слово вне сегмента совпадения */
  noise: -0.3,
} as const;

/**
 * Ниже этого кандидат отбрасывается.
 *
 * Тождество продукта к этому моменту уже проверено условиями выше, поэтому
 * порог отсеивает не «непохожее», а несоответствие вида: сухую крупу на
 * запрос о варёной (готовность не подтверждена, −1.5), чужой способ
 * приготовления (−1). Пустой результат отправит позицию на разложение по
 * ингредиентам, а оттуда — в ручной ввод; занижённое вдвое число не
 * отправит никуда, человек его просто не заметит.
 */
const MIN_SCORE = 0.5;

export interface MatchInput {
  /** Английское название от модели */
  nameEn: string;
  preparation?: Preparation;
}

export interface ScoredCandidate {
  product: NewProduct;
  score: number;
}

/** Описание, по которому судим о кандидате */
function describe(product: NewProduct): string {
  return product.nameEn ?? product.nameRu;
}

/**
 * Оценивает кандидата. `null` — не тот продукт, а не «плохо подходит»:
 * такие даже не сравниваются между собой.
 *
 * Описания USDA — иерархия через запятую (`Beverages, coffee, brewed`), и
 * оценка это использует. Лишнее значимое слово внутри того же сегмента, где
 * нашлось совпадение, — признак другой сущности (`Rose-apples`, `Apple
 * juice`). Лишний сегмент рядом — обычно категория (`Beverages`) или
 * уточнение (`broilers or fryers`), и это ничему не мешает.
 */
export function scoreCandidate(
  input: MatchInput,
  product: NewProduct,
): number | null {
  const queryTokens = tokenize(input.nameEn).filter((t) => !STOP.has(t));
  let core = [...new Set(queryTokens.filter(isCore))];
  let modifiers = [...new Set(queryTokens.filter(isModifier))];

  /**
   * Запрос целиком из уточняющих слов — значит они здесь и есть продукт.
   *
   * «sugar», «salt», «water», «oil» стоят в словаре модификаторов, потому
   * что в описаниях USDA они почти всегда уточнение («with added sugar»).
   * Но человек ест и сам сахар: без этой оговорки запрос «sugar» не имел
   * ни одного значимого слова и отбрасывался целиком — в пробе так
   * отвалились все десять кандидатов, включая `Sugars, granulated`.
   */
  if (core.length === 0 && modifiers.length > 0) {
    core = modifiers;
    modifiers = [];
  }

  // Без значимого слова судить не о чем: русское название до USDA
  // не доходит, и совпадать там нечему.
  if (core.length === 0) return null;

  /**
   * Разделители — запятая и точка с запятой: в описаниях фастфуда USDA
   * пишет `Fast foods, cheeseburger; double, large patty; with condiments`,
   * и без точки с запятой «cheeseburger; double» читалось одним сегментом.
   */
  const segments = describe(product)
    .split(/[,;]/)
    .map(tokenize)
    .filter((tokens) => tokens.length > 0);
  if (segments.length === 0) return null;

  const descriptionTokens = segments.flat();
  const present = new Set(descriptionTokens);

  // Каждое значимое слово запроса обязано найтись: «buckwheat» не может
  // ответиться карточкой риса, как бы высоко её ни поставил поиск USDA.
  if (!core.every((token) => present.has(token))) return null;

  const asked = new Set([...core, ...modifiers]);

  /**
   * Запрос сам про готовое изделие — бургер, сэндвич, пиццу.
   *
   * Тогда проверка форм не применяется вовсе: описания таких блюд в USDA
   * состоят из слов-компонентов, и правило «в описании есть форма, которой
   * нет в запросе» браковало ровно то, что нужно. На «cheeseburger»
   * отбраковывались все шестнадцать кандидатов из-за слова «patty», а на
   * «hamburger bun» — `Roll, white, hamburger bun` из-за слова «roll».
   * Котлета и булочка — части бургера, а не другой продукт.
   *
   * Совпадение по подстроке, а не по токену: «cheeseburger» одно слово,
   * и «burger» внутри него токенизацией не выделяется.
   */
  const drink = core.some((token) => DRINK_WORDS.has(token));
  const readyMade =
    core.some((token) => READY_FORMS.has(token) || DRINK_WORDS.has(token)) ||
    core.some((token) => COMPOSED_DISHES.some((form) => token.includes(form)));


  /**
   * Продукт в другой форме — начинка пирога, сок, сухофрукт, детское
   * питание. Отбраковка, а не штраф: это не «хуже подходит», это не то.
   *
   * Для напитков послабление узкое: снимаются только слова жидкой формы
   * («drink», «soda»), а концентраты — нет. Полное снятие проверки давало
   * на «tea» растворимый чай в порошке: 345 ккал/100 г против единицы
   * у заваренного, то есть ошибку в триста раз.
   */
  const forbidden = descriptionTokens.some((token) => {
    if (!PROCESSED.has(token) || asked.has(token)) return false;
    if (readyMade && !drink) return false;
    return !(drink && LIQUID_FORMS.has(token));
  });

  if (forbidden) return null;

  /**
   * Описание не про продукт, а про его часть: отдельный сегмент из одних
   * только «skin» или «seam fat». Оборот «with skin» под правило не
   * попадает — там кожура лишь уточняет, что яблоко нечищеное.
   */
  /**
   * Сегменты с процентами и словом «lean» — это состав, а не часть туши:
   * `Beef, ground, 80% lean meat / 20% fat, patty, cooked, broiled` —
   * идеальная карточка котлеты, а правило про части браковало её из-за
   * слова «fat». Жирность фарша в номенклатуре всегда пишется процентами.
   */
  const composition = /\d\s*%|\blean\b/i;
  const rawSegments = describe(product).split(/[,;]/);

  const describesPart = segments.some((tokens, segmentIndex) => {
    if (composition.test(rawSegments[segmentIndex] ?? '')) return false;

    return tokens.some((token, index) => {
      if (!PARTS.has(token) || asked.has(token)) return false;
      // Уточнение узнаётся по предлогу прямо перед словом: «with skin»,
      // «cooked in skin». Без предлога — «external fat», «skin» — это
      // и есть содержимое карточки.
      const before = index > 0 ? tokens[index - 1] : null;
      return before === null || !QUALIFYING_PREPOSITIONS.has(before);
    });
  });
  if (describesPart) return null;

  /**
   * Где стоит совпадение. Первый сегмент — главный продукт описания;
   * если наше слово нашлось только дальше, мы, скорее всего, попали
   * в уточнение чужого продукта: `Croissants, apple`, `Cheese, mozzarella,
   * whole milk`. Категорийный префикс (`Beverages, coffee`) пропускаем.
   */
  const headIndex = segments.findIndex((tokens) =>
    tokens.some((t) => core.includes(t)),
  );
  const beforeHead = segments.slice(0, headIndex);
  const prefixIsCategory = beforeHead.every((tokens) =>
    tokens.filter(isCore).every((t) => CATEGORIES.has(t)),
  );

  /**
   * Для готовых изделий требование к префиксу мягче.
   *
   * `Roll, white, hamburger bun` — булочка для бургера, но перед совпадением
   * стоит сорт («white»), а не категория, и строгое правило её браковало.
   * Из-за этого разложение бургера теряло булочку. Для обычных продуктов
   * правило остаётся жёстким: на «whole milk» оно не даёт ответить
   * `Cheese, mozzarella, whole milk` — молоко изделием не считается.
   */
  if (!prefixIsCategory && !(readyMade && !drink)) return null;

  let score: number = WEIGHTS.base;

  /**
   * Чистота имени — условие, а не слагаемое.
   *
   * Штрафом это уже было, и вот что вышло: карточка `Rose-apples, raw`,
   * лежавшая в кеше, отвечала на запрос «сырое яблоко». Штраф за чужое
   * слово в имени (−1.2) перекрывался бонусом за совпавшее состояние
   * (+2) — и сомнение в том, тот ли это вообще продукт, оказывалось
   * оплачено тем, что продукт правильно сырой.
   *
   * Это разные вопросы, и складывать их нельзя. «Тот ли продукт» решается
   * до всякой оценки: у каждого значимого слова запроса должен быть
   * сегмент, где оно стоит без чужих примесей. `Apples, raw` проходит,
   * `Rose-apples` (25 ккал вместо 52) и `Sugar-apples` (94) — нет.
   */
  const named = core.every((token) =>
    segments.some(
      (tokens) =>
        tokens.includes(token) &&
        !tokens.some((other) => !isTransparent(other) && !asked.has(other)),
    ),
  );
  if (!named) return null;

  // Шум считается только вне сегментов совпадения: примеси внутри них уже
  // наказаны выше, и складывать одно с другим значило бы наказать дважды.
  const matchedSegments = new Set(
    segments.filter((tokens) => tokens.some((t) => core.includes(t))),
  );
  const noise = segments
    .filter((tokens) => !matchedSegments.has(tokens))
    .flat()
    .filter(
      (token) =>
        isCore(token) && !asked.has(token) && !CATEGORIES.has(token),
    ).length;
  score += WEIGHTS.noise * noise;

  const matchedModifiers = modifiers.filter(
    (token) => present.has(token) && !RAW.has(token) && !COOKED.has(token),
  ).length;
  score += WEIGHTS.modifier * matchedModifiers;

  const wanted =
    input.preparation && input.preparation !== 'unknown'
      ? input.preparation
      : null;

  if (wanted) {
    const synonyms = PREPARATION[wanted];
    const exact = affirms(descriptionTokens, synonyms);
    const generic = affirms(descriptionTokens, GENERIC_COOKED);
    const otherMethod = descriptionTokens.some(
      (t) => ANY_METHOD.has(t) && !synonyms.has(t),
    );
    /**
     * Замороженное без пометки о готовке — заготовка, а не блюдо.
     *
     * `Potatoes, french fried, all types, frozen, as purchased` (147 ккал)
     * содержит слово «fried» и выигрывало у настоящей жареной картошки
     * (197): это полуфабрикат в том виде, в каком он лежит в магазине.
     * Слово «unprepared» стоит не везде, а «frozen» — стоит.
     */
    const frozenBlank =
      descriptionTokens.includes('frozen') &&
      !affirms(descriptionTokens, GENERIC_COOKED);
    const raw = frozenBlank || descriptionTokens.some((t) => RAW.has(t));
    // Только про готовку: `ANY_METHOD` включает и слова о сыром, и на
    // «сырой помидор» строка `Tomatoes, grape, raw` считалась противоречием
    const cooked = generic || affirms(descriptionTokens, COOKED);

    /**
     * Сырое проверяется раньше способа приготовления.
     *
     * Иначе побеждал полуфабрикат: `Potatoes, frozen, french fried, par
     * fried, extruded, unprepared` содержит слово «fried» дважды и получал
     * точное совпадение, хотя «unprepared» означает, что готовить его ещё
     * предстоит. На запрос о жареной картошке это ответ о замороженной.
     */
    // У готового изделия способ приготовления не спрашиваем: он уже
    // в названии. Проверка на сырое при этом остаётся — «frozen, not
    // reheated» это полуфабрикат, а не блюдо с тарелки.
    if (wanted !== 'raw' && raw && !generic) {
      score += WEIGHTS.stateConflict;
    } else if (wanted === 'raw' && cooked) {
      score += WEIGHTS.stateConflict;
    } else if (readyMade) {
      // Ни бонуса, ни штрафа: состояние тут ничего не различает
    } else if (exact) {
      score += WEIGHTS.methodMatch;
    } else if (wanted === 'fried') {
      /**
       * Для жарки общее «cooked» не годится вовсе.
       *
       * На «жареная картошка» так выигрывал `Potato, cooked, as ingredient`
       * с 81 ккал против 197 у настоящей жареной: разницу делает впитавшееся
       * масло, и никакое слово в описании о нём не скажет. Отказ отправляет
       * позицию на разложение по ингредиентам, где масло попадёт в состав
       * отдельной строкой, — это ближе к правде, чем картошка без него.
       */
      return null;
    } else if (generic) {
      /**
       * Общее «cooked» подтверждает готовность, но упоминание чужого
       * способа рядом не отменяется, а складывается с ним.
       *
       * Различить два случая лексически нельзя: в `Buckwheat groats,
       * roasted, cooked` обжарка относится к сорту крупы, а в `Potatoes,
       * boiled, cooked in skin` варка — к тому, что с картошкой сделали.
       * Сумма оставляет первое в игре и опускает второе ниже настоящего
       * совпадения по способу.
       */
      score += WEIGHTS.methodGeneric;
      if (otherMethod) score += WEIGHTS.methodOther;
    } else if (otherMethod) {
      score += WEIGHTS.methodOther;
    } else {
      score += WEIGHTS.stateUnconfirmed;
    }
  } else if (
    descriptionTokens.includes('frozen') &&
    !affirms(descriptionTokens, GENERIC_COOKED)
  ) {
    /**
     * Способ модель не назвала, но замороженная заготовка — точно не то,
     * что лежало на тарелке. На «наггетсы» так выигрывала строка
     * `Chicken, nuggets, precooked, frozen, not reheated` (261 ккал)
     * у готовых `Chicken nuggets, NFS` (307).
     */
    score += WEIGHTS.frozenBlank;
  } else if (descriptionTokens.some((t) => COOKED.has(t))) {
    score += WEIGHTS.unaskedCooking;
  }

  if (product.isVerified) score += WEIGHTS.reliable;

  return score;
}

/**
 * Выбирает лучшего кандидата или отказывается выбирать.
 *
 * Порядок выдачи USDA не учитывается вовсе: именно доверие к нему и было
 * причиной ошибки с яблоком.
 */
/**
 * Насколько кандидаты должны разойтись по счёту, чтобы выбор считался
 * осознанным, и насколько при этом им позволено расходиться в калорийности.
 *
 * Правило нужно для недоопределённых запросов, где разница кратная:
 * сухая крупа против варёной, цельное молоко против сгущённого.
 *
 * Допуск широкий намеренно. При двадцати пяти процентах правило срабатывало
 * на сортах одного продукта — `Apple, raw` (61 ккал) против `Apples, raw,
 * with skin` (52), мякоть картофеля против кожуры, — и приложение отказывалось
 * считать там, где любой из ответов был бы верным с точностью до сорта.
 * Отказ в такой ситуации хуже выбора: он отправляет человека вводить числа
 * руками ради разницы, которая меньше погрешности оценки веса порции.
 */
const AMBIGUOUS_SCORE_GAP = 0.5;
const AMBIGUOUS_KCAL_SPREAD = 0.6;

/**
 * Минимальная абсолютная разница, при которой расхождение вообще имеет смысл.
 *
 * У малокалорийного относительная разница огромна при ничтожной абсолютной:
 * заваренный кофе 1 ккал/100 г против эспрессо 9 — это 89% расхождения
 * и восемь килокалорий. Без этого порога приложение отказывалось считать
 * кофе и колу, то есть самые частые позиции в дневнике.
 */
const AMBIGUOUS_KCAL_MIN = 25;

export function pickBestMatch<T extends NewProduct>(
  input: MatchInput,
  candidates: T[],
): T | null {
  const scored: { product: T; score: number }[] = [];

  for (const product of candidates) {
    const score = scoreCandidate(input, product);
    if (score !== null && score >= MIN_SCORE) scored.push({ product, score });
  }

  if (scored.length === 0) return null;

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // При равном счёте берём более короткое описание: в номенклатуре USDA
    // это, как правило, базовый продукт, а не его вариация.
    return describe(a.product).length - describe(b.product).length;
  });

  const [best, runnerUp] = scored;

  if (runnerUp && best.score - runnerUp.score < AMBIGUOUS_SCORE_GAP) {
    const diff = Math.abs(best.product.kcalPer100g - runnerUp.product.kcalPer100g);
    const spread = diff / Math.max(best.product.kcalPer100g, 1);
    if (spread > AMBIGUOUS_KCAL_SPREAD && diff > AMBIGUOUS_KCAL_MIN) return null;
  }

  return best.product;
}

/**
 * Слова, из-за которых карточка не описывает базовый продукт: форма
 * («juice», «pie») или часть («fat», «skin»).
 *
 * Нужны для разбора уже закешированного: исходный запрос, по которому
 * карточка попала в справочник, не сохраняется, поэтому проверить её тем
 * же путём нельзя. Наличие такого слова — не приговор (карточка сока
 * законна, если человек пил сок), а повод посмотреть глазами.
 */
export function formOrPartWords(description: string): string[] {
  const tokens = tokenize(description);
  return [...new Set(tokens.filter((t) => PROCESSED.has(t) || PARTS.has(t)))];
}

/** Для пробы против живого USDA: весь разбор кандидатов, включая отброшенных */
export function explainMatches(
  input: MatchInput,
  candidates: NewProduct[],
): { product: NewProduct; score: number | null; accepted: boolean }[] {
  return candidates.map((product) => {
    const score = scoreCandidate(input, product);
    return { product, score, accepted: score !== null && score >= MIN_SCORE };
  });
}
