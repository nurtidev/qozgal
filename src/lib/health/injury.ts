/**
 * Сопоставление травм с упражнениями.
 *
 * Главное решение здесь такое же, как с калориями: решает не модель,
 * а таблица. Соответствие «травма → движения, которые её нагружают»
 * задано разметкой упражнений в справочнике и не меняется от запуска
 * к запуску.
 *
 * Причина та же, что и в подсчёте калорий, но цена ошибки другая.
 * Сгенерированный ответ невоспроизводим: одно и то же упражнение сегодня
 * разрешено, завтра запрещено. С калориями это стоит трёхсот килокалорий
 * в день, здесь — человек с больной поясницей делает становую тягу,
 * потому что в этот раз модель не сочла её опасной.
 *
 * Модели в этом разделе остаётся то, что она умеет лучше таблицы: понять
 * из фразы «болит поясница, когда наклоняюсь», о какой области речь.
 *
 * И отдельно: приложение не ставит диагнозов и не разрешает нагрузку.
 * Оно показывает, что движение нагружает больное место, и оставляет
 * решение человеку и его врачу.
 */

export type BodyArea =
  | 'lower_back'
  | 'neck'
  | 'shoulder'
  | 'elbow'
  | 'wrist'
  | 'hip'
  | 'knee'
  | 'ankle';

export type InjurySeverity = 'watch' | 'pain' | 'medical';

export interface ActiveInjury {
  area: BodyArea;
  severity: InjurySeverity;
}

export interface Conflict {
  area: BodyArea;
  /** Самая тяжёлая из травм этой области: она и определяет тон предупреждения */
  severity: InjurySeverity;
}

/** Врачебный запрет весомее боли, боль весомее «беспокоит» */
const WEIGHT: Record<InjurySeverity, number> = {
  watch: 1,
  pain: 2,
  medical: 3,
};

/**
 * Какие из активных травм задевает упражнение.
 *
 * Пустой список — упражнение с травмами не пересекается. Это не значит
 * «безопасно»: у нас размечены типовые движения, а не конкретный человек
 * с конкретным диагнозом.
 */
export function conflictsFor(
  loadsAreas: string[] | null | undefined,
  injuries: ActiveInjury[],
): Conflict[] {
  if (!loadsAreas || loadsAreas.length === 0) return [];

  const byArea = new Map<BodyArea, InjurySeverity>();

  for (const injury of injuries) {
    if (!loadsAreas.includes(injury.area)) continue;
    const known = byArea.get(injury.area);
    if (!known || WEIGHT[injury.severity] > WEIGHT[known]) {
      byArea.set(injury.area, injury.severity);
    }
  }

  return [...byArea].map(([area, severity]) => ({ area, severity }));
}

/**
 * Насколько настойчиво предупреждать. Скрывать упражнение совсем мы не
 * вправе: у человека может быть разрешение врача именно на это движение
 * в щадящем варианте, и запрет вместо предупреждения он обойдёт мимо
 * приложения — вместе со всем остальным учётом.
 */
export function worstSeverity(conflicts: Conflict[]): InjurySeverity | null {
  if (conflicts.length === 0) return null;
  return conflicts.reduce((worst, c) =>
    WEIGHT[c.severity] > WEIGHT[worst.severity] ? c : worst,
  ).severity;
}
