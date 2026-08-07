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

  const url = new URL(`${BASE_URL}/foods/search`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('query', query);
  url.searchParams.set('pageSize', String(limit));
  url.searchParams.set('dataType', DATA_TYPES.join(','));

  try {
    const response = await fetch(url, {
      signal: signal ?? AbortSignal.timeout(8000),
      // Справочник меняется редко — кешируем на сутки, чтобы не тратить
      // квоту API на повторные запросы одного и того же продукта.
      next: { revalidate: 86_400 },
    });

    if (!response.ok) {
      console.warn(`USDA вернул ${response.status} на запрос "${query}"`);
      return [];
    }

    const data = (await response.json()) as UsdaSearchResponse;
    return (data.foods ?? [])
      .map(toProduct)
      .filter((p): p is NewProduct => p !== null);
  } catch (error) {
    // Недоступность внешнего справочника не должна ломать разбор еды:
    // остаются локальная база и ручной ввод.
    console.warn(
      `Поиск в USDA не удался для "${query}":`,
      error instanceof Error ? error.message : error,
    );
    return [];
  }
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
