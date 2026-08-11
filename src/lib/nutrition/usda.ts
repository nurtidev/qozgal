import type { NewProduct } from '@/db/schema';

/**
 * Клиент USDA FoodData Central — бесплатной государственной базы нутриентов.
 * Ключ получается за минуту: https://fdc.nal.usda.gov/api-key-signup.html
 *
 * База покрывает базовые продукты и международные блюда, но не знает
 * национальную кухню региона — бешбармак и курт в ней искать бесполезно.
 * Локальные блюда живут в собственном справочнике (src/db/seed-data).
 */

const BASE_URL = 'https://api.nal.usda.gov/fdc/v1';

/** Идентификаторы нутриентов в номенклатуре USDA */
const NUTRIENT_IDS = {
  energyKcal: 1008,
  protein: 1003,
  fat: 1004,
  carbs: 1005,
  fiber: 1079,
  sugar: 2000,
  sodium: 1093,
} as const;

/**
 * Приоритет типов данных. Foundation и SR Legacy — лабораторные измерения,
 * Survey — усреднённые блюда. Branded не используем: там пользовательские
 * данные с производителей, качество разное, а поиск замусоривается брендами.
 */
const DATA_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'] as const;

/** Те же наборы без Survey (FNDDS): на них шлюз USDA не спотыкается */
const RELIABLE_DATA_TYPES = ['Foundation', 'SR Legacy'] as const;

interface UsdaNutrient {
  nutrientId: number;
  value: number;
}

interface UsdaFood {
  fdcId: number;
  description: string;
  dataType: string;
  foodNutrients: UsdaNutrient[];
}

interface UsdaSearchResponse {
  foods?: UsdaFood[];
}

function nutrientValue(food: UsdaFood, id: number): number | null {
  const found = food.foodNutrients.find((n) => n.nutrientId === id);
  return found?.value ?? null;
}

/** Приводит запись USDA к нашей карточке продукта */
function toProduct(food: UsdaFood): NewProduct | null {
  const kcal = nutrientValue(food, NUTRIENT_IDS.energyKcal);
  const protein = nutrientValue(food, NUTRIENT_IDS.protein);
  const fat = nutrientValue(food, NUTRIENT_IDS.fat);
  const carbs = nutrientValue(food, NUTRIENT_IDS.carbs);

  // Запись без основных макронутриентов бесполезна для дневника
  if (kcal == null || protein == null || fat == null || carbs == null) {
    return null;
  }

  return {
    nameRu: food.description,
    nameEn: food.description,
    source: 'usda',
    externalId: String(food.fdcId),
    kcalPer100g: kcal,
    proteinPer100g: protein,
    fatPer100g: fat,
    carbsPer100g: carbs,
    fiberPer100g: nutrientValue(food, NUTRIENT_IDS.fiber),
    sugarPer100g: nutrientValue(food, NUTRIENT_IDS.sugar),
    sodiumMgPer100g: nutrientValue(food, NUTRIENT_IDS.sodium),
    isVerified: food.dataType === 'Foundation' || food.dataType === 'SR Legacy',
  };
}

export interface UsdaSearchOptions {
  /** Сколько кандидатов вернуть — дальше их ранжирует резолвер */
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Ищет продукт по английскому названию, которое вернула модель распознавания.
 *
 * @returns кандидаты, отсортированные по релевантности USDA;
 *          пустой массив при отсутствии ключа, сетевой ошибке или пустой выдаче
 */
export async function searchUsda(
  query: string,
  apiKey: string | undefined,
  options: UsdaSearchOptions = {},
): Promise<NewProduct[]> {
  if (!apiKey) return [];
  if (!query.trim()) return [];

  const { limit = 5, signal } = options;

  /**
   * Порядок попыток: сначала все наборы, потом — без Survey (FNDDS).
   *
   * Шлюз USDA отбивает нгинксовым 400 часть запросов, где в dataType стоит
   * «Survey (FNDDS)» — значение со скобками и пробелом. В замере: 16 из 16
   * запросов без этого набора прошли, а с ним отказывала примерно треть,
   * причём отказы шли пачками — похоже на один сломанный узел за
   * балансировщиком. Дело не в темпе: паузы между запросами картину
   * не меняли.
   *
   * Поэтому не слепые повторы, а деградация: при отказе спрашиваем те же
   * данные без проблемного набора. Полный запрос идёт первым, потому что
   * FNDDS — это готовые блюда, и для распознавания тарелки они часто
   * оказываются лучшим совпадением, чем сырые ингредиенты.
   *
   * Молча вернуть пустоту нельзя: позиция осталась бы без нутриентов,
   * и человек увидел бы «нет данных» там, где данные есть.
   */
  const attempts: readonly (readonly string[])[] = [
    DATA_TYPES,
    RELIABLE_DATA_TYPES,
    RELIABLE_DATA_TYPES,
  ];

  for (let attempt = 0; attempt < attempts.length; attempt++) {
    const url = new URL(`${BASE_URL}/foods/search`);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('query', query);
    url.searchParams.set('pageSize', String(limit));
    url.searchParams.set('dataType', attempts[attempt].join(','));

    try {
      const response = await fetch(url, {
        signal: signal ?? AbortSignal.timeout(8000),
        // Справочник меняется редко — кешируем на сутки, чтобы не тратить
        // квоту API на повторные запросы одного и того же продукта.
        next: { revalidate: 86_400 },
      });

      if (response.ok) {
        if (attempt > 0) {
          console.warn(
            `USDA: "${query}" получен без набора Survey (FNDDS) с попытки ${attempt + 1}`,
          );
        }
        const data = (await response.json()) as UsdaSearchResponse;
        return (data.foods ?? [])
          .map(toProduct)
          .filter((p): p is NewProduct => p !== null);
      }

      if (attempt === attempts.length - 1) {
        console.warn(
          `USDA вернул ${response.status} на запрос "${query}" — сдались после ${attempts.length} попыток`,
        );
        return [];
      }
    } catch (error) {
      // Недоступность внешнего справочника не должна ломать разбор еды:
      // остаются локальная база, разложение на ингредиенты и ручной ввод.
      if (attempt === attempts.length - 1) {
        console.warn(
          `Поиск в USDA не удался для "${query}":`,
          error instanceof Error ? error.message : error,
        );
        return [];
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return [];
}

/**
 * Собирает кандидатов под одну позицию: отдельно по названию и отдельно
 * по названию со способом приготовления.
 *
 * Два запроса, а не один, из-за того, как USDA понимает релевантность.
 * На «rice boiled» она отдала десять строк, где не было риса вовсе:
 * `Chicken, feet, boiled`, `Asparagus, cooked, boiled`, `Beets, cooked,
 * boiled` — слово «boiled» встречается в номенклатуре тысячи раз и
 * перетягивает выдачу на себя. Голый «rice» отдаёт рис.
 *
 * Способ приготовления при этом нужен: без него в выдаче по «potato»
 * не окажется жареной картошки. Поэтому оба списка складываются, а
 * выбирает из них `pickBestMatch`, для которого приготовление — критерий
 * оценки, а не поиска.
 *
 * Запросы бесплатны и кешируются на сутки, так что второй ничего не стоит.
 */
export async function searchUsdaCandidates(
  input: { nameEn: string; preparation?: string },
  apiKey: string | undefined,
  options: UsdaSearchOptions = {},
): Promise<NewProduct[]> {
  /**
   * Пятьдесят, а не десять: в первой десятке по «rice» стоят `Rice
   * crackers` и шесть строк `Snacks, rice cakes` — рисовые хлебцы
   * релевантнее риса по мнению поиска. Сам рис нашёлся глубже.
   */
  const { limit = 50, signal } = options;
  const queries = [input.nameEn];

  if (input.preparation && input.preparation !== 'unknown') {
    queries.push(`${input.nameEn} ${input.preparation}`);

    /**
     * Третий запрос — с общим словом «cooked» вместо конкретного способа.
     *
     * У поиска USDA свои представления о синонимах: «rice boiled» не
     * находит варёный рис вообще, «rice» находит только дикий (101 ккал),
     * а «rice cooked» отдаёт `Rice, cooked, NFS` — те самые 129 ккал,
     * которые и нужны. Слово «boiled» стоит у морепродуктов и овощей,
     * а рис в номенклатуре просто «cooked».
     */
    if (input.preparation !== 'raw') {
      queries.push(`${input.nameEn} cooked`);
    }
  }

  const results = await Promise.all(
    queries.map((query) => searchUsda(query, apiKey, { limit, signal })),
  );

  // Одна и та же карточка приходит по обоим запросам — держим первую
  const seen = new Set<string>();
  const candidates: NewProduct[] = [];

  for (const product of results.flat()) {
    const key = product.externalId ?? product.nameEn ?? product.nameRu;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(product);
  }

  return candidates;
}

/* ────────────────────── Open Food Facts (штрихкоды) ────────────────── */

interface OffProduct {
  product_name?: string;
  product_name_ru?: string;
  brands?: string;
  nutriments?: Record<string, number | string | undefined>;
}

function offNumber(
  nutriments: OffProduct['nutriments'],
  key: string,
): number | null {
  const raw = nutriments?.[key];
  const value = typeof raw === 'string' ? Number(raw) : raw;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Ищет упакованный продукт по штрихкоду. Ключ не нужен, база открытая.
 * Покрытие локальных марок неровное, поэтому это дополнение к ручному
 * вводу, а не замена ему.
 */
export async function lookupBarcode(
  barcode: string,
  signal?: AbortSignal,
): Promise<NewProduct | null> {
  if (!/^\d{8,14}$/.test(barcode)) return null;

  try {
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json`,
      {
        signal: signal ?? AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'qozgal/1.0 (food tracker)' },
        next: { revalidate: 86_400 },
      },
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      status?: number;
      product?: OffProduct;
    };
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    const n = p.nutriments;

    const kcal = offNumber(n, 'energy-kcal_100g');
    const protein = offNumber(n, 'proteins_100g');
    const fat = offNumber(n, 'fat_100g');
    const carbs = offNumber(n, 'carbohydrates_100g');

    if (kcal == null || protein == null || fat == null || carbs == null) {
      return null;
    }

    const name = p.product_name_ru || p.product_name;
    if (!name) return null;

    return {
      nameRu: name,
      nameEn: p.product_name ?? null,
      brand: p.brands ?? null,
      source: 'off',
      externalId: barcode,
      barcode,
      kcalPer100g: kcal,
      proteinPer100g: protein,
      fatPer100g: fat,
      carbsPer100g: carbs,
      fiberPer100g: offNumber(n, 'fiber_100g'),
      sugarPer100g: offNumber(n, 'sugars_100g'),
      sodiumMgPer100g: (() => {
        const sodiumG = offNumber(n, 'sodium_100g');
        return sodiumG != null ? sodiumG * 1000 : null;
      })(),
      // Данные вносят пользователи Open Food Facts — доверие ниже, чем к USDA
      isVerified: false,
    };
  } catch (error) {
    console.warn(
      `Поиск по штрихкоду ${barcode} не удался:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
