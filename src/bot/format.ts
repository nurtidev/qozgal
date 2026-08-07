import type { ResolvedItem, Nutrition } from '@/lib/nutrition/resolve';
import type { Recognition } from '@/lib/ai/schemas';
import { translator, type Locale } from '@/i18n/messages';

/** Экранирование для parse_mode: HTML — в названиях блюд встречаются кавычки и & */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

type T = ReturnType<typeof translator>;

/**
 * Метка достоверности позиции. Показывается только там, где есть о чём
 * предупредить: значок у каждой строки превращается в шум и перестаёт
 * работать ровно тогда, когда он нужен.
 */
function confidenceMark(item: ResolvedItem): string {
  if (!item.nutrition) return ' ❓';
  if (item.item.confidence < 0.5) return ' ⚠️';
  return '';
}

function formatItem(resolved: ResolvedItem, t: T, locale: Locale): string {
  const { item, nutrition, matchedBy, product } = resolved;
  // Модель отвечает по-русски: язык промпта один. Если позиция нашлась
  // в справочнике и у карточки есть казахское имя, показываем его
  const name = escapeHtml(
    locale === 'kk' && product?.nameKk ? product.nameKk : item.nameRu,
  );
  const mark = confidenceMark(resolved);
  const grams = `${item.grams} ${t('common.g')}`;

  if (!nutrition) {
    return `• ${name} — ${grams}${mark}\n  <i>${t('bot.noProduct')}</i>`;
  }

  // Блюдо собрано из ингредиентов, а не найдено готовой карточкой.
  // Знак «≈» отличает такую цифру от прямого попадания в справочник:
  // числа по-прежнему из базы, но пропорции состава — оценка.
  const approx = matchedBy === 'derived' ? '≈' : '';

  return `• ${name} — ${grams} · <b>${approx}${nutrition.kcal} ${t('common.kcal')}</b>${mark}`;
}

export interface EntrySummaryInput {
  recognition: Recognition;
  resolved: ResolvedItem[];
  total: Nutrition;
  /** Сколько уже съедено за день, включая этот приём */
  dayKcal?: number;
  dayTargetKcal?: number;
  /** Язык пользователя из его записи в базе */
  locale?: Locale;
}

/** Карточка разбора, которую пользователь подтверждает или правит */
export function formatEntrySummary(input: EntrySummaryInput): string {
  const { recognition, resolved, total, dayKcal, dayTargetKcal } = input;
  const locale = input.locale ?? 'ru';
  const t = translator(locale);

  const lines: string[] = [];
  lines.push(`<b>${t(MEAL_KEYS[recognition.mealType])}</b>`);
  lines.push('');
  lines.push(...resolved.map((item) => formatItem(item, t, locale)));
  lines.push('');
  lines.push(
    `<b>${t('bot.total', { kcal: total.kcal })}</b>\n` +
      t('macros.short', {
        protein: total.proteinG,
        fat: total.fatG,
        carbs: total.carbsG,
      }),
  );

  const unmatched = resolved.filter((r) => !r.nutrition).length;
  if (unmatched > 0) {
    lines.push('');
    lines.push(`<i>${t('bot.unmatched', { count: unmatched })}</i>`);
  }

  const derived = resolved.filter((r) => r.matchedBy === 'derived');
  if (derived.length > 0) {
    const names = derived.map((r) => escapeHtml(r.item.nameRu)).join(', ');
    lines.push('');
    lines.push(`<i>≈ ${t('bot.derived', { names })}</i>`);
  }

  const lowConfidence = resolved.filter(
    (r) => r.nutrition && r.item.confidence < 0.5,
  );
  if (lowConfidence.length > 0) {
    const reasons = lowConfidence
      .map((r) => r.item.uncertainty)
      .filter((u) => u.trim().length > 0);
    // Пояснение модели приходит на языке промпта, то есть по-русски.
    // Своя фраза честнее показывает язык интерфейса, но конкретика модели
    // полезнее общего предупреждения — поэтому она в приоритете.
    lines.push('');
    lines.push(
      reasons.length > 0
        ? `<i>⚠️ ${escapeHtml(reasons[0])}</i>`
        : `<i>⚠️ ${t('bot.lowConfidence')}</i>`,
    );
  }

  if (recognition.notes.trim()) {
    lines.push('');
    lines.push(`<i>${escapeHtml(recognition.notes)}</i>`);
  }

  if (dayKcal != null && dayTargetKcal != null) {
    const left = dayTargetKcal - dayKcal;
    lines.push('');
    lines.push(
      left >= 0
        ? t('bot.dayLeft', { eaten: dayKcal, target: dayTargetKcal, left })
        : t('bot.dayOver', {
            eaten: dayKcal,
            target: dayTargetKcal,
            over: Math.abs(left),
          }),
    );
  }

  return lines.join('\n');
}

const MEAL_KEYS = {
  breakfast: 'meals.breakfast',
  lunch: 'meals.lunch',
  dinner: 'meals.dinner',
  snack: 'meals.snack',
} as const;

/** Приветствие при /start — на языке клиента Telegram */
export function welcome(locale: Locale): string {
  return translator(locale)('bot.welcome');
}
