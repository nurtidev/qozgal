import { or, ilike, sql } from 'drizzle-orm';
import { db } from '@/db';
import { products, type Product, type NewProduct } from '@/db/schema';
import { env } from '@/env';
import { searchUsdaCandidates } from './usda';
import { pickBestMatch } from './match';
import { decomposeDish, type Ingredient } from '@/lib/ai/decompose';
import type { RecognizedItem, Preparation } from '@/lib/ai/schemas';

/* ────────────────────── Пересчёт на порцию ─────────────────────────── */

export interface Nutrition {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

/** Переводит нутриенты продукта со 100 г на фактический вес порции */
export function scaleToPortion(product: Product, grams: number): Nutrition {
  const k = grams / 100;
  return {
    kcal: Math.round(product.kcalPer100g * k),
    proteinG: Math.round(product.proteinPer100g * k * 10) / 10,
    fatG: Math.round(product.fatPer100g * k * 10) / 10,
    carbsG: Math.round(product.carbsPer100g * k * 10) / 10,
  };
}

/* ───────────────────────── Поиск в справочнике ─────────────────────── */

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Источники, где название — это описание USDA или Open Food Facts */
const EXTERNAL_SOURCES = new Set(['usda', 'off']);

async function findLocal(
  nameRu: string,
  nameEn: string,
  preparation?: Preparation,
): Promise<Product | null> {
  const ru = normalize(nameRu);
  const en = normalize(nameEn);

  const [exact] = await db
    .select()
    .from(products)
    .where(
      or(
        sql`lower(${products.nameRu}) = ${ru}`,
        sql`lower(${products.nameKk}) = ${ru}`,
        sql`lower(${products.nameEn}) = ${en}`,
      ),
    )
    // Выверенные карточки локальной кухни важнее случайного совпадения,
    // а собранное из ингредиентов — последнее по доверию.
    .orderBy(
      sql`case ${products.source}
            when 'local' then 0
            when 'usda' then 1
            when 'off' then 2
            when 'user' then 3
            else 4 end`,
      sql`case when ${products.isVerified} then 0 else 1 end`,
    )
    .limit(1);

  if (exact) return exact;

  const partial = await db
    .select()
    .from(products)
    .where(
      or(ilike(products.nameRu, `%${ru}%`), ilike(products.nameEn, `%${en}%`)),
    )
    .orderBy(
      sql`case ${products.source}
            when 'local' then 0
            when 'usda' then 1
            when 'off' then 2
            when 'user' then 3
            else 4 end`,
      sql`case when ${products.isVerified} then 0 else 1 end`,
      // Из нескольких совпадений берём самое короткое название: «рис»
      // предпочтительнее «рис с овощами и курицей в соусе терияки»
      sql`length(${products.nameRu})`,
    )
    .limit(10);

  if (partial.length === 0) return null;

  /**
   * Свои карточки берём по совпадению названия, кеш внешних справочников —
   * только после той же проверки, что и свежая выдача USDA.
   *
   * Без этого починка отбора кандидатов работала бы вполсилы: `Rose-apples,
   * raw` уже лежит в кеше, и запрос «apple» находил бы её по частичному
   * совпадению `nameEn ilike '%apple%'` в обход всякой оценки. Одна
   * неудачная карточка отвечала бы за яблоко всем пользователям и дальше.
   */
  const own = partial.find((p) => !EXTERNAL_SOURCES.has(p.source));
  if (own) return own;

  return pickBestMatch({ nameEn, preparation }, partial);
}

async function cacheProduct(candidate: NewProduct): Promise<Product | null> {
  const [saved] = await db
    .insert(products)
    .values(candidate)
    .onConflictDoUpdate({
      target: [products.source, products.externalId],
      set: { nameRu: candidate.nameRu },
    })
    .returning();

  return saved ?? null;
}

/**
 * Прямой поиск: локальный справочник, затем USDA. Без разложения на
 * ингредиенты — иначе разбор блюда уходил бы в бесконечную рекурсию,
 * раскладывая каждый ингредиент на подингредиенты.
 */
async function resolveDirect(
  nameRu: string,
  nameEn: string,
  preparation?: Preparation,
): Promise<Product | null> {
  const local = await findLocal(nameRu, nameEn, preparation);
  if (local) return local;

  /**
   * Кандидатов берём с запасом и выбираем сами.
   *
   * Раньше здесь стоял limit 1 и первый результат уходил в кеш как есть —
   * на «apple» так закрепилась карточка `Rose-apples, raw` с 25 ккал/100 г
   * вместо 52. Порядок выдачи USDA считает релевантностью строковое
   * совпадение и о том, что мы ищем еду, не знает: на тот же запрос она
   * ставила выше `Croissants, apple` (254 ккал) и `Pie, apple` (296).
   */
  const input = { nameEn, preparation };
  const candidates = await searchUsdaCandidates(input, env.USDA_API_KEY);
  const candidate = pickBestMatch(input, candidates);

  if (!candidate) {
    // Пустая выдача и отбракованная — разные события: во втором случае
    // в USDA что-то есть, но не то, и это материал для настройки весов.
    if (candidates.length > 0) {
      console.warn(
        `USDA: ни один из ${candidates.length} кандидатов не подошёл под "${nameEn}"`,
      );
    }
    return null;
  }

  return cacheProduct(candidate);
}

/* ─────────────────── Сборка блюда из ингредиентов ──────────────────── */

/**
 * Доля веса блюда, которую нужно опознать, чтобы итогу можно было верить.
 *
 * Порог существует ради конкретного сценария: в куырдаке нашлись лук и
 * картофель, но не нашлась баранина. Сумма получится втрое ниже реальной,
 * и при этом будет выглядеть как обычная посчитанная цифра. Лучше честно
 * отдать «не смогли», чем тихо занизить дневной итог.
 */
const MIN_INGREDIENT_COVERAGE = 0.6;

/** Ниже этой уверенности разложение не сохраняется в общий справочник */
const MIN_CACHE_CONFIDENCE = 0.6;

interface AssembledDish {
  nutrition: Nutrition;
  coverage: number;
  resolvedIngredients: number;
  totalIngredients: number;
}

async function assembleFromIngredients(
  ingredients: Ingredient[],
): Promise<AssembledDish | null> {
  const totalGrams = ingredients.reduce((acc, i) => acc + i.grams, 0);
  if (totalGrams <= 0) return null;

  const resolved = await Promise.all(
    ingredients.map(async (ing) => {
      const product = await resolveDirect(ing.nameRu, ing.nameEn);
      return { ing, product };
    }),
  );

  let matchedGrams = 0;
  const nutrition: Nutrition = { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 };

  for (const { ing, product } of resolved) {
    if (!product) continue;
    matchedGrams += ing.grams;
    const part = scaleToPortion(product, ing.grams);
    nutrition.kcal += part.kcal;
    nutrition.proteinG += part.proteinG;
    nutrition.fatG += part.fatG;
    nutrition.carbsG += part.carbsG;
  }

  const coverage = matchedGrams / totalGrams;
  if (coverage < MIN_INGREDIENT_COVERAGE) return null;

  // Опознали не всё — недостающее восполняем пропорционально опознанному.
  // Это точнее, чем просто отбросить неопознанный вес: пропуск обычно
  // приходится на ингредиент, похожий по калорийности на остальные.
  const scale = 1 / coverage;

  return {
    nutrition: {
      kcal: Math.round(nutrition.kcal * scale),
      proteinG: Math.round(nutrition.proteinG * scale * 10) / 10,
      fatG: Math.round(nutrition.fatG * scale * 10) / 10,
      carbsG: Math.round(nutrition.carbsG * scale * 10) / 10,
    },
    coverage,
    resolvedIngredients: resolved.filter((r) => r.product).length,
    totalIngredients: ingredients.length,
  };
}

/**
 * Сохраняет собранное блюдо в справочник, чтобы следующий пользователь
 * получил его сразу, без второго вызова модели.
 *
 * Есть риск: одно неудачное разложение станет канонической карточкой для
 * всех. Поэтому сохраняем только уверенные разборы, помечаем их
 * непроверенными и ставим последними в порядке ранжирования.
 */
async function cacheDerived(
  item: RecognizedItem,
  assembled: AssembledDish,
): Promise<Product | null> {
  const per100 = 100 / item.grams;

  return cacheProduct({
    nameRu: item.nameRu,
    nameEn: item.nameEn,
    source: 'derived',
    externalId: `derived:${normalize(item.nameRu)}`,
    kcalPer100g: Math.round(assembled.nutrition.kcal * per100),
    proteinPer100g: Math.round(assembled.nutrition.proteinG * per100 * 10) / 10,
    fatPer100g: Math.round(assembled.nutrition.fatG * per100 * 10) / 10,
    carbsPer100g: Math.round(assembled.nutrition.carbsG * per100 * 10) / 10,
    defaultPortionG: item.grams,
    isVerified: false,
  });
}

/* ─────────────────────────── Точка входа ───────────────────────────── */

export type MatchSource = 'local' | 'usda' | 'derived' | 'none';

export interface ResolvedItem {
  item: RecognizedItem;
  product: Product | null;
  nutrition: Nutrition | null;
  /** Откуда взялись цифры — показываем пользователю степень доверия */
  matchedBy: MatchSource;
  /** Заполняется для matchedBy = 'derived': из чего собрано */
  derivedFrom?: {
    ingredients: Ingredient[];
    coverage: number;
    resolvedIngredients: number;
    totalIngredients: number;
  };
}

/**
 * Подбирает нутриенты под одну распознанную позицию.
 *
 * Порядок отражает степень доверия к источнику:
 *  1. справочник — выверенные карточки локальной кухни и кеш USDA;
 *  2. USDA — базовые продукты и международные блюда;
 *  3. разложение на ингредиенты — блюда нет целиком, но модель знает состав,
 *     и каждый ингредиент ищется в справочнике; числа остаются из базы;
 *  4. ничего — позиция сохраняется без нутриентов, пользователь вводит их сам.
 *     Такие случаи стоит собирать: это точный список пробелов в справочнике.
 */
export async function resolveItem(item: RecognizedItem): Promise<ResolvedItem> {
  const direct = await resolveDirect(item.nameRu, item.nameEn, item.preparation);

  if (direct) {
    return {
      item,
      product: direct,
      nutrition: scaleToPortion(direct, item.grams),
      matchedBy: direct.source === 'derived' ? 'derived' : direct.source === 'local' ? 'local' : 'usda',
    };
  }

  const decomposed = await decomposeDish(item);
  if (!decomposed.ok) {
    return { item, product: null, nutrition: null, matchedBy: 'none' };
  }

  const assembled = await assembleFromIngredients(
    decomposed.decomposition.ingredients,
  );
  if (!assembled) {
    return { item, product: null, nutrition: null, matchedBy: 'none' };
  }

  const cached =
    decomposed.decomposition.confidence >= MIN_CACHE_CONFIDENCE
      ? await cacheDerived(item, assembled)
      : null;

  return {
    item,
    product: cached,
    nutrition: assembled.nutrition,
    matchedBy: 'derived',
    derivedFrom: {
      ingredients: decomposed.decomposition.ingredients,
      coverage: assembled.coverage,
      resolvedIngredients: assembled.resolvedIngredients,
      totalIngredients: assembled.totalIngredients,
    },
  };
}

/** Подбирает нутриенты сразу под весь разбор */
export async function resolveItems(
  items: RecognizedItem[],
): Promise<ResolvedItem[]> {
  // Позиции независимы — обрабатываем параллельно, чтобы не складывать
  // задержки обращений к USDA и разложения.
  return Promise.all(items.map(resolveItem));
}

/** Суммарные нутриенты приёма пищи; позиции без совпадения не учитываются */
export function totalNutrition(resolved: ResolvedItem[]): Nutrition {
  return resolved.reduce<Nutrition>(
    (acc, r) => {
      if (!r.nutrition) return acc;
      return {
        kcal: acc.kcal + r.nutrition.kcal,
        proteinG: Math.round((acc.proteinG + r.nutrition.proteinG) * 10) / 10,
        fatG: Math.round((acc.fatG + r.nutrition.fatG) * 10) / 10,
        carbsG: Math.round((acc.carbsG + r.nutrition.carbsG) * 10) / 10,
      };
    },
    { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
  );
}
