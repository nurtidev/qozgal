import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import { env } from '@/env';
import type { RecognizedItem } from './schemas';

/**
 * Разложение — текстовая задача: вспомнить типовую рецептуру по названию
 * блюда. Зрительного суждения здесь нет, поэтому используется та же модель,
 * что и для текстового разбора.
 */
const MODEL = process.env.RECOGNITION_TEXT_MODEL ?? 'claude-haiku-4-5';
const MAX_TOKENS = 4096;

/** Haiku 4.5 не принимает output_config.effort и серверные фолбэки */
const SUPPORTS_EFFORT = !MODEL.startsWith('claude-haiku');
const SUPPORTS_FALLBACKS =
  MODEL.startsWith('claude-opus-5') || MODEL.startsWith('claude-fable');

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

/* ──────────────────────────── Схема ────────────────────────────────── */

export const ingredientSchema = z.object({
  nameRu: z.string().describe('Название ингредиента по-русски'),
  nameEn: z
    .string()
    .describe(
      'Английское название для поиска в USDA, с указанием готовности: "beef, cooked", "rice, boiled"',
    ),
  grams: z
    .number()
    .describe('Вес ингредиента в готовом блюде, в граммах'),
});

export const decompositionSchema = z.object({
  /** false — блюдо не раскладывается: БАД, напиток неизвестного состава, смесь */
  isDecomposable: z
    .boolean()
    .describe('Можно ли разложить блюдо на понятные ингредиенты'),
  ingredients: z.array(ingredientSchema),
  confidence: z
    .number()
    .describe('Уверенность в составе и пропорциях, от 0 до 1'),
});

export type Decomposition = z.infer<typeof decompositionSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;

/* ──────────────────────────── Промпт ───────────────────────────────── */

/**
 * Промпт разложения. Отдельный от распознавания, потому что задача другая:
 * там — увидеть, здесь — вспомнить типовую рецептуру.
 *
 * Ключевое требование — веса в готовом виде. При варке мясо теряет воду,
 * а крупа её набирает, поэтому сумма сырых ингредиентов не равна весу
 * порции на тарелке. Считать надо от того, что реально лежит в тарелке,
 * и искать в справочнике соответствующие приготовленные позиции.
 */
export const DECOMPOSITION_SYSTEM = `
Ты раскладываешь готовое блюдо на ингредиенты для расчёта калорийности по справочнику нутриентов.

Блюда нет в справочнике целиком, поэтому его калорийность будет собрана из ингредиентов. От тебя нужен состав типовой порции — не рецепт приготовления.

# Веса — в готовом виде

Указывай, сколько каждого ингредиента содержится в порции такой, какой её едят. Не вес сырых продуктов: при варке мясо теряет воду, крупа и макароны её набирают, и пересчёт от сырья даст неверный результат.

Сумма весов ингредиентов должна примерно совпадать с указанным весом порции. Расхождение в пределах 10% допустимо, кратное — нет.

# Английские названия

В nameEn указывай состояние продукта так, как это принято в базе USDA: "beef, cooked, braised", "rice, white, cooked", "onions, raw", "wheat flour dough, fried". От состояния зависит калорийность: у варёного и жареного картофеля она различается более чем вдвое.

Но если у компонента есть собственное название продукта — давай его, а не описание из продукта и способа. "beef patty" находится в справочнике, "beef, cooked, fried" — нет: там первым делом попадаются субпродукты и жареный рис с мясом. То же с "hamburger bun" вместо "bread, wheat", "bacon" вместо "pork, cured, fried". Это не отменяет предыдущего правила: состояние дописывается там, где своего названия у компонента нет.

# Что учитывать

Включай жир, на котором готовили, и заметные добавки — они дают существенную часть калорийности и их проще всего упустить. Для жареного блюда впитавшееся масло обязательно.

Не дроби ниже разумного: соль, специи и зелень в количествах до нескольких граммов на калорийность не влияют.

# Когда разложить нельзя

Если состав неизвестен принципиально — фабричный продукт неизвестной рецептуры, БАД, напиток неопределённого состава — поставь isDecomposable в false и оставь ingredients пустым.

# Уверенность

Ставь высокую уверенность для блюд со сложившейся рецептурой и низкую там, где состав сильно различается от повара к повару.
`.trim();

/* ───────────────────────────── Вызов ───────────────────────────────── */

export type DecompositionOutcome =
  | { ok: true; decomposition: Decomposition }
  | { ok: false; reason: 'not_decomposable' | 'refused' | 'api_error' };

/**
 * Раскладывает блюдо на ингредиенты, когда его нет в справочнике целиком.
 *
 * Вызывается только на несовпавших позициях, поэтому на обычной еде
 * дополнительной стоимости не возникает: гречка, куриная грудка и хлеб
 * находятся в USDA напрямую.
 */
export async function decomposeDish(
  item: RecognizedItem,
): Promise<DecompositionOutcome> {
  const description = [
    `Блюдо: ${item.nameRu}`,
    item.nameEn && item.nameEn !== item.nameRu
      ? `Английское название: ${item.nameEn}`
      : null,
    `Вес порции: ${item.grams} г`,
    item.preparation !== 'unknown'
      ? `Способ приготовления: ${item.preparation}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      ...(SUPPORTS_FALLBACKS
        ? {
            betas: ['server-side-fallback-2026-07-01' as const],
            fallbacks: 'default' as const,
          }
        : {}),
      system: [
        {
          type: 'text',
          text: DECOMPOSITION_SYSTEM,
          cache_control: { type: 'ephemeral' },
        },
      ],
      output_config: {
        ...(SUPPORTS_EFFORT ? { effort: 'medium' as const } : {}),
        format: betaZodOutputFormat(decompositionSchema),
      },
      messages: [{ role: 'user', content: description }],
    });

    if (response.stop_reason === 'refusal') {
      return { ok: false, reason: 'refused' };
    }

    const parsed = response.parsed_output;
    if (!parsed || !parsed.isDecomposable || parsed.ingredients.length === 0) {
      return { ok: false, reason: 'not_decomposable' };
    }

    return { ok: true, decomposition: sanitize(parsed, item.grams) };
  } catch (error) {
    console.error(`Разложение "${item.nameRu}" не удалось:`, error);
    return { ok: false, reason: 'api_error' };
  }
}

/**
 * Приводит сумму весов ингредиентов к весу порции.
 *
 * Модель иногда возвращает состав на другой размер порции — например,
 * на «стандартные 100 г» вместо указанных 350. Без нормировки это дало бы
 * калорийность, заниженную втрое, причём без каких-либо признаков ошибки.
 * Пропорциональное масштабирование сохраняет соотношение ингредиентов,
 * которое модель знает хорошо, и чинит абсолютный масштаб, где она путается.
 */
function sanitize(
  decomposition: Decomposition,
  targetGrams: number,
): Decomposition {
  const ingredients = decomposition.ingredients
    .map((ing) => ({
      ...ing,
      nameRu: ing.nameRu.trim(),
      nameEn: ing.nameEn.trim(),
      grams: Number.isFinite(ing.grams) ? Math.max(0, ing.grams) : 0,
    }))
    .filter((ing) => ing.grams > 0 && ing.nameRu.length > 0);

  const sum = ingredients.reduce((acc, ing) => acc + ing.grams, 0);
  if (sum <= 0) {
    return { ...decomposition, ingredients: [] };
  }

  const ratio = targetGrams / sum;

  // Отклонение в пределах 10% — нормальный разброс рецептур, не трогаем.
  if (ratio > 0.9 && ratio < 1.1) {
    return { ...decomposition, ingredients };
  }

  return {
    ...decomposition,
    ingredients: ingredients.map((ing) => ({
      ...ing,
      grams: Math.round(ing.grams * ratio * 10) / 10,
    })),
    // Масштабирование — признак того, что модель промахнулась с порцией,
    // поэтому итоговой уверенности доверяем меньше.
    confidence: decomposition.confidence * 0.8,
  };
}
