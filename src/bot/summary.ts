import { translator, type Locale } from '@/i18n/messages';
import type { DayTotals } from '@/db/queries';

/**
 * Сводка дня, закреплённая в чате.
 *
 * Одно сообщение на человека, которое бот переписывает после каждой записи.
 * Смысл — превратить чат из ленты в приборную панель: открыв бота, человек
 * видит остаток дня в шапке, не открывая приложение и не листая переписку.
 *
 * Поэтому здесь ровно то, ради чего открывают дневник, и ничего сверх:
 * остаток калорий, три нутриента и перечень съеденного. Совет, поощрение
 * и «отличная работа!» в закреплённом сообщении читаются один раз, а висят
 * всегда — и человек перестаёт замечать вместе с ними и цифры.
 */

export interface SummaryMeal {
  /** Ключ приёма пищи: breakfast, lunch, dinner, snack */
  mealType: string;
  kcal: number;
}

export interface SummaryInput {
  locale: Locale;
  /** Дата, за которую собрана сводка, в формате ГГГГ-ММ-ДД */
  date: string;
  /** Как показать дату человеку: «10 августа» */
  dateLabel: string;
  totals: DayTotals;
  meals: SummaryMeal[];
  goal: {
    kcalTarget: number;
    proteinTargetG: number;
    fatTargetG: number;
    carbTargetG: number;
  } | null;
  /** Тоннаж сегодняшних тренировок, если они были */
  workoutVolumeKg?: number;
}

const MEAL_KEYS = {
  breakfast: 'meals.breakfast',
  lunch: 'meals.lunch',
  dinner: 'meals.dinner',
  snack: 'meals.snack',
} as const;

export function formatDaySummary(input: SummaryInput): string {
  const t = translator(input.locale);
  const { totals, goal } = input;

  const lines: string[] = [];
  lines.push(`<b>${input.dateLabel}</b>`);
  lines.push('');

  if (goal) {
    const left = goal.kcalTarget - totals.kcal;
    lines.push(
      left >= 0
        ? `<b>${t('bot.summaryLeft', { left })}</b>`
        : `<b>${t('bot.summaryOver', { over: Math.abs(left) })}</b>`,
    );
    lines.push(t('bot.summaryOf', { eaten: totals.kcal, target: goal.kcalTarget }));
    lines.push('');
    // Нутриенты одной строкой: в закреплённом сообщении важнее компактность,
    // чем полосы прогресса — их видно в приложении
    lines.push(
      t('bot.summaryMacros', {
        protein: Math.round(totals.proteinG),
        proteinTarget: Math.round(goal.proteinTargetG),
        fat: Math.round(totals.fatG),
        fatTarget: Math.round(goal.fatTargetG),
        carbs: Math.round(totals.carbsG),
        carbsTarget: Math.round(goal.carbTargetG),
      }),
    );
  } else {
    lines.push(`<b>${t('bot.summaryEaten', { kcal: totals.kcal })}</b>`);
    lines.push(
      t('macros.short', {
        protein: Math.round(totals.proteinG),
        fat: Math.round(totals.fatG),
        carbs: Math.round(totals.carbsG),
      }),
    );
  }

  if (input.meals.length > 0) {
    lines.push('');
    for (const meal of input.meals) {
      const name = MEAL_KEYS[meal.mealType as keyof typeof MEAL_KEYS];
      lines.push(
        `• ${name ? t(name) : meal.mealType} — ${meal.kcal} ${t('common.kcal')}`,
      );
    }
  } else {
    lines.push('');
    lines.push(`<i>${t('bot.summaryEmpty')}</i>`);
  }

  // Тренировка показывается фактом, без пересчёта в калории: она уже учтена
  // коэффициентом активности в норме, и второй раз её считать нельзя
  if (input.workoutVolumeKg && input.workoutVolumeKg > 0) {
    lines.push('');
    lines.push(
      `<i>${t('bot.summaryWorkout', { kg: input.workoutVolumeKg })}</i>`,
    );
  }

  return lines.join('\n');
}
