/**
 * Калибровка оценки веса порции.
 *
 * Модель оценивает вес на глаз, человек правит цифру перед сохранением —
 * и обе величины лежат рядом в базе (`ai_estimated_grams` и `grams`).
 * Разница между ними и есть единственный честный отзыв о качестве оценки,
 * который приложение получает само, без опросов и разметки.
 *
 * Зачем это считать. Систематическое смещение опаснее случайного разброса:
 * ошибка «плюс-минус двадцать граммов в обе стороны» на пяти записях в день
 * взаимно гасится, а «всегда на 15% меньше» — накапливается. Ровно от этого
 * приложение и защищается справочником нутриентов, но вес порции остаётся
 * зоной, где ошибается модель, и заметить смещение можно только так.
 *
 * Главная оговорка, без которой числа врут. Отсутствие правки НЕ означает,
 * что оценка верна: человек мог подтвердить не глядя. Поэтому смещение
 * считается отдельно по правленым позициям (там мнение человека выражено
 * явно) и отдельно по всем — второе занижено на долю тех, кто просто
 * нажал «Сохранить».
 */

export interface WeightSample {
  /** Что предложила модель */
  estimatedG: number;
  /** Что осталось после человека */
  finalG: number;
  /** Уверенность модели в позиции, 0..1 */
  confidence: number | null;
  source: 'photo' | 'text' | 'repeat' | 'barcode' | 'manual';
  /** Нашлась ли позиция в справочнике нутриентов */
  matched: boolean;
}

/**
 * Правка меньше грамма — это округление, а не мнение о весе.
 * Без порога любая позиция с 90.0 против 90.000001 считалась бы правленой.
 */
const EDIT_THRESHOLD_G = 1;

/**
 * Ниже этого числа правок выводы делать рано.
 *
 * Порог не из статистической таблицы, а из практики: на десятке наблюдений
 * медиана скачет от одной записи, и «модель занижает на 20%» будет означать
 * лишь то, что кто-то однажды доложил себе добавку.
 */
export const MIN_EDITS_FOR_VERDICT = 20;

export function isEdited(sample: WeightSample): boolean {
  return Math.abs(sample.finalG - sample.estimatedG) >= EDIT_THRESHOLD_G;
}

/**
 * Относительная ошибка оценки: +0.2 означает, что человек поставил
 * на 20% больше, то есть модель занижала.
 */
export function relativeError(sample: WeightSample): number {
  if (sample.estimatedG <= 0) return 0;
  // Округление до сотых долей процента: 120/100 − 1 в двоичной дроби даёт
  // 0.19999999999999996, и этот хвост дотягивался бы до отчёта. Точность
  // ниже 0.01% в оценке веса порции смысла не имеет
  return Math.round((sample.finalG / sample.estimatedG - 1) * 10_000) / 10_000;
}

/** Медиана — она устойчива к одной позиции, где вместо 200 г набрали 2000 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/** Значение квантиля методом ближайшего ранга — хватает для разброса правок */
export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(q * sorted.length) - 1),
  );
  return sorted[index];
}

export interface Slice {
  label: string;
  count: number;
  edits: number;
  /** Доля правленых позиций, 0..1 */
  editShare: number;
  /** Медиана относительной ошибки по правленым позициям */
  biasEdited: number | null;
  /** То же по всем позициям среза — заведомо ближе к нулю */
  biasAll: number | null;
}

export function summarize(label: string, samples: WeightSample[]): Slice {
  const edited = samples.filter(isEdited);

  return {
    label,
    count: samples.length,
    edits: edited.length,
    editShare: samples.length > 0 ? edited.length / samples.length : 0,
    biasEdited: median(edited.map(relativeError)),
    biasAll: median(samples.map(relativeError)),
  };
}

export interface CalibrationReport {
  overall: Slice;
  /** Разброс правок: четверть из них ниже p25, четверть выше p75 */
  spread: { p25: number | null; p75: number | null };
  bySource: Slice[];
  byConfidence: Slice[];
  byMatch: Slice[];
  /** Хватает ли правок, чтобы говорить о смещении всерьёз */
  enoughData: boolean;
}

/**
 * Разрезы выбраны не для полноты картины, а под конкретные вопросы,
 * которые меняли бы промпт или интерфейс:
 *
 * - источник: в тексте человек часто сам называет вес («200 грамм курицы»),
 *   и правки там означают, что мы не расслышали названное число;
 * - уверенность: если при 0.9 правят так же часто, как при 0.4, значит
 *   поле confidence бесполезно и на него нельзя вешать предупреждения;
 * - совпадение со справочником: систематическая правка ненайденных позиций
 *   говорит, что дело не в глазомере, а в пробелах справочника.
 */
export function calibrate(samples: WeightSample[]): CalibrationReport {
  const overall = summarize('всего', samples);
  const editedErrors = samples.filter(isEdited).map(relativeError);

  const bySource = groupBy(samples, (s) => s.source).map(([key, group]) =>
    summarize(key, group),
  );

  const byConfidence = [
    summarize('уверенность ≥ 0.8', samples.filter((s) => (s.confidence ?? 0) >= 0.8)),
    summarize(
      'уверенность 0.5–0.8',
      samples.filter((s) => (s.confidence ?? 0) >= 0.5 && (s.confidence ?? 0) < 0.8),
    ),
    summarize('уверенность < 0.5', samples.filter((s) => (s.confidence ?? 0) < 0.5)),
  ].filter((slice) => slice.count > 0);

  const byMatch = [
    summarize('нашлось в справочнике', samples.filter((s) => s.matched)),
    summarize('не нашлось', samples.filter((s) => !s.matched)),
  ].filter((slice) => slice.count > 0);

  return {
    overall,
    spread: { p25: quantile(editedErrors, 0.25), p75: quantile(editedErrors, 0.75) },
    bySource,
    byConfidence,
    byMatch,
    enoughData: overall.edits >= MIN_EDITS_FOR_VERDICT,
  };
}

/**
 * Во что смещение обходится за день.
 *
 * Прикидка, а не расчёт: считает, что ошибка веса переносится в калории
 * линейно и одинаково для всех позиций. Нужна она затем, чтобы перевести
 * проценты в единицу, которой человек живёт: «модель занижает на 12%»
 * ничего не говорит, «это 260 ккал в день мимо дневника» — говорит всё.
 */
export function dailyKcalImpact(bias: number, dailyKcal: number): number {
  return Math.round(bias * dailyKcal);
}

function groupBy<T, K extends string>(items: T[], key: (item: T) => K): [K, T[]][] {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return [...map];
}
