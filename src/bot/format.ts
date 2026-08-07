import type { ResolvedItem, Nutrition } from '@/lib/nutrition/resolve';
import type { Recognition } from '@/lib/ai/schemas';

/** Экранирование для parse_mode: HTML — в названиях блюд встречаются кавычки и & */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const MEAL_LABELS: Record<string, string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};

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

function formatItem(resolved: ResolvedItem): string {
  const { item, nutrition, matchedBy } = resolved;
  const name = escapeHtml(item.nameRu);
  const mark = confidenceMark(resolved);

  if (!nutrition) {
    return `• ${name} — ${item.grams} г${mark}\n  <i>нет в справочнике, укажите калорийность вручную</i>`;
  }

  // Блюдо собрано из ингредиентов, а не найдено готовой карточкой.
  // Знак «≈» отличает такую цифру от прямого попадания в справочник:
  // числа по-прежнему из базы, но пропорции состава — оценка.
  const approx = matchedBy === 'derived' ? '≈' : '';

  return `• ${name} — ${item.grams} г · <b>${approx}${nutrition.kcal} ккал</b>${mark}`;
}

export interface EntrySummaryInput {
  recognition: Recognition;
  resolved: ResolvedItem[];
  total: Nutrition;
  /** Сколько уже съедено за день, включая этот приём */
  dayKcal?: number;
  dayTargetKcal?: number;
}

/** Карточка разбора, которую пользователь подтверждает или правит */
export function formatEntrySummary(input: EntrySummaryInput): string {
  const { recognition, resolved, total, dayKcal, dayTargetKcal } = input;

  const lines: string[] = [];
  lines.push(`<b>${MEAL_LABELS[recognition.mealType] ?? 'Приём пищи'}</b>`);
  lines.push('');
  lines.push(...resolved.map(formatItem));
  lines.push('');
  lines.push(
    `<b>Итого: ${total.kcal} ккал</b>\n` +
      `Б ${total.proteinG} · Ж ${total.fatG} · У ${total.carbsG}`,
  );

  const unmatched = resolved.filter((r) => !r.nutrition).length;
  if (unmatched > 0) {
    lines.push('');
    lines.push(
      `<i>Итог посчитан без ${unmatched} ${plural(unmatched, 'позиции', 'позиций', 'позиций')} — их нет в справочнике.</i>`,
    );
  }

  const derived = resolved.filter((r) => r.matchedBy === 'derived');
  if (derived.length > 0) {
    const names = derived.map((r) => escapeHtml(r.item.nameRu)).join(', ');
    lines.push('');
    lines.push(
      `<i>≈ ${names} — блюда нет в справочнике целиком, калорийность собрана по составу.</i>`,
    );
  }

  const lowConfidence = resolved.filter(
    (r) => r.nutrition && r.item.confidence < 0.5,
  );
  if (lowConfidence.length > 0) {
    const reasons = lowConfidence
      .map((r) => r.item.uncertainty)
      .filter((u) => u.trim().length > 0);
    lines.push('');
    lines.push(
      reasons.length > 0
        ? `<i>⚠️ ${escapeHtml(reasons[0])}</i>`
        : '<i>⚠️ Вес оценён приблизительно — проверьте перед сохранением.</i>',
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
        ? `За день: ${dayKcal} из ${dayTargetKcal} ккал · осталось ${left}`
        : `За день: ${dayKcal} из ${dayTargetKcal} ккал · перебор ${Math.abs(left)}`,
    );
  }

  return lines.join('\n');
}

/** Русское склонение после числительного */
export function plural(
  n: number,
  one: string,
  few: string,
  many: string,
): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const WELCOME = `
Привет! Я помогу вести дневник питания.

<b>Как записать еду</b>
Пришлите фотографию блюда или напишите словами — например, «две сосиски и гречка». Я разберу состав, оценю вес и посчитаю калории по справочнику.

Оценку веса можно поправить перед сохранением: по фотографии точный вес не определить, и лучше исправить цифру, чем копить неточности.

<b>Что в приложении</b>
Дашборд за день, замеры тела, динамика веса и план питания — по кнопке ниже.
`.trim();
