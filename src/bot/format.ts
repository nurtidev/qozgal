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

/**
 * Название позиции на языке человека.
 *
 * Модель отвечает по-русски: язык промпта один. Если позиция нашлась
 * в справочнике и у карточки есть казахское имя, показываем его.
 */
function localName(resolved: ResolvedItem, locale: Locale): string {
  const { item, product } = resolved;
  return locale === 'kk' && product?.nameKk ? product.nameKk : item.nameRu;
}

function formatItem(resolved: ResolvedItem, t: T, locale: Locale): string {
  const { item, nutrition, matchedBy, product } = resolved;
  const name = escapeHtml(localName(resolved, locale));
  const mark = confidenceMark(resolved);
  const grams = `${item.grams} ${t('common.g')}`;

  if (!nutrition) {
    return `• ${name} — ${grams}${mark}\n  <i>${t('bot.noProduct')}</i>`;
  }

  /**
   * Знак «≈» отличает приблизительную цифру от выверенной. Причин две,
   * и обе честнее показать, чем скрыть:
   *  — блюдо собрано из ингредиентов, а не найдено готовой карточкой:
   *    числа из базы, но пропорции состава — оценка;
   *  — карточка справочника заведена расчётом по типовой рецептуре
   *    и не сверена с измерениями: расхождение доходит до четверти.
   */
  const approx =
    matchedBy === 'derived' || product?.isVerified === false ? '≈' : '';

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

  // Непроверенные карточки — отдельной строкой от собранных по составу:
  // причина приблизительности разная, и человеку, который захочет
  // перепроверить цифру, важно знать какая
  const estimated = resolved.filter(
    (r) => r.matchedBy !== 'derived' && r.product?.isVerified === false,
  );
  if (estimated.length > 0) {
    const names = estimated
      .map((r) => escapeHtml(localName(r, locale)))
      .join(', ');
    lines.push('');
    lines.push(`<i>≈ ${t('bot.estimated', { names })}</i>`);
  }

  const lowConfidence = resolved.filter(
    (r) => r.nutrition && r.item.confidence < 0.5,
  );
  if (lowConfidence.length > 0) {
    // Причина приходит кодом, а текст берётся из словаря на языке
    // пользователя: раньше здесь печаталось пояснение модели, а оно
    // всегда на языке промпта — то есть по-русски даже в казахском боте
    const reason = lowConfidence
      .map((r) => r.item.uncertainty)
      .find((code) => code !== 'none');

    lines.push('');
    lines.push(
      `<i>⚠️ ${
        reason ? t(`bot.uncertainty.${reason}`) : t('bot.lowConfidence')
      }</i>`,
    );
  }

  if (recognition.note !== 'none') {
    lines.push('');
    lines.push(`<i>${t(`bot.note.${recognition.note}`)}</i>`);
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
