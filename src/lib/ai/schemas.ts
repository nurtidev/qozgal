import { z } from 'zod';

/**
 * Способ приготовления заметно меняет калорийность одного и того же продукта:
 * 100 г варёной картошки и 100 г жареной различаются больше чем вдвое.
 * Поэтому он входит в поисковый запрос к справочнику нутриентов.
 */
export const preparationSchema = z.enum([
  'raw',
  'boiled',
  'fried',
  'baked',
  'grilled',
  'steamed',
  'stewed',
  'unknown',
]);

export type Preparation = z.infer<typeof preparationSchema>;

export const recognizedItemSchema = z.object({
  /** Название на русском — его увидит пользователь на экране подтверждения */
  nameRu: z.string().describe('Название продукта или блюда по-русски'),
  /** Английское название — по нему ищем в USDA FoodData Central */
  nameEn: z
    .string()
    .describe('Общепринятое английское название для поиска в базе нутриентов'),
  /** Оценка веса съеденного. Пользователь поправит её перед сохранением. */
  grams: z.number().describe('Оценка веса порции в граммах'),
  confidence: z
    .number()
    .describe('Уверенность в определении продукта и веса, от 0 до 1'),
  preparation: preparationSchema.describe('Способ приготовления'),
  /** Что именно мешало точности — показываем при низкой уверенности */
  uncertainty: z
    .string()
    .describe(
      'Что мешает точной оценке: скрытые ингредиенты, неясный размер порции, ракурс. Пустая строка, если всё однозначно.',
    ),
});

export type RecognizedItem = z.infer<typeof recognizedItemSchema>;

export const recognitionSchema = z.object({
  /** false — на фото не еда; бот ответит понятной ошибкой вместо мусора */
  isFood: z.boolean().describe('Есть ли на изображении или в описании еда'),
  mealType: z
    .enum(['breakfast', 'lunch', 'dinner', 'snack'])
    .describe('Предполагаемый приём пищи по составу блюд'),
  items: z
    .array(recognizedItemSchema)
    .describe('Отдельные продукты и блюда; составное блюдо не разбирается на ингредиенты'),
  /** Замечания к разбору целиком, а не к отдельной позиции */
  notes: z
    .string()
    .describe(
      'Общее замечание к разбору для пользователя. Пустая строка, если замечаний нет.',
    ),
});

export type Recognition = z.infer<typeof recognitionSchema>;

/* ─────────────────── Результат работы модуля ───────────────────────── */

/**
 * Отказ описывается кодом, а не фразой: текст для пользователя лежит
 * в словарях (`bot.failure.*`) и зависит от его языка, а модуль
 * распознавания языка интерфейса не знает.
 */
export type RecognitionOutcome =
  | { ok: true; recognition: Recognition; meta: RecognitionMeta }
  | { ok: false; reason: RecognitionFailure };

export type RecognitionFailure =
  | 'not_food' // на фото не еда
  | 'refused' // сработали классификаторы безопасности
  | 'empty' // модель не вернула ни одной позиции
  | 'malformed' // ответ не прошёл валидацию схемы
  | 'api_error'; // сеть, лимиты, недоступность

export interface RecognitionMeta {
  model: string;
  latencyMs: number;
  /** Токены, обработанные по полной цене (изображение и переменная часть) */
  inputTokens: number;
  outputTokens: number;
  /** Прочитано из кеша — стоит 0.1× от входной цены */
  cacheReadTokens: number;
  /**
   * Записано в кеш — стоит 1.25× от входной цены. Без этого поля учёт
   * занижает стоимость: системный промпт при холодном кеше оплачивается
   * с наценкой, а не бесплатно.
   */
  cacheWriteTokens: number;
}

