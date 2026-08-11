/**
 * Статистика питания за период.
 *
 * Главная ловушка здесь — дни без записей. Если считать их нулями, среднее
 * за месяц у человека, который вёл дневник восемнадцать дней из тридцати,
 * окажется на треть ниже реального. Он посмотрит на «1500 ккал в среднем»
 * при норме 2200, решит, что ест мало, и добавит еды — хотя в дни, когда
 * он записывал, всё было в порядке.
 *
 * Поэтому среднее считается только по дням с записями, а количество
 * пропущенных показывается рядом: это не украшение отчёта, а условие,
 * при котором среднее вообще что-то значит.
 */

export interface DayStat {
  /** ГГГГ-ММ-ДД */
  date: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  /** Сколько записей подтверждено за день; ноль — день не вёлся */
  entryCount: number;
}

export interface StatsSummary {
  /** Дней с хотя бы одной записью */
  daysLogged: number;
  /** Длина периода в днях */
  daysTotal: number;
  /** Среднее по дням с записями; null — считать не от чего */
  avgKcal: number | null;
  avgProteinG: number | null;
  avgFatG: number | null;
  avgCarbsG: number | null;
  /**
   * Среднее отклонение от нормы: минус — недобор, плюс — перебор.
   * null, если нормы нет или нет ни одного дня с записями.
   */
  avgDeviation: number | null;
  /** Дней, уложившихся в норму с допуском */
  withinNormDays: number;
}

/**
 * Допуск, в пределах которого день считается «в норме».
 *
 * Ровно попасть в цифру невозможно и не нужно: погрешность оценки веса
 * порции сама по себе больше. Сто килокалорий — примерно один банан,
 * то есть тот масштаб, на котором разница уже что-то значит.
 */
const NORM_TOLERANCE_KCAL = 100;

export function summarize(
  days: DayStat[],
  kcalTarget: number | null,
): StatsSummary {
  const logged = days.filter((day) => day.entryCount > 0);

  const average = (pick: (day: DayStat) => number) =>
    logged.length === 0
      ? null
      : Math.round(logged.reduce((sum, day) => sum + pick(day), 0) / logged.length);

  const avgKcal = average((day) => day.kcal);

  return {
    daysLogged: logged.length,
    daysTotal: days.length,
    avgKcal,
    avgProteinG: average((day) => day.proteinG),
    avgFatG: average((day) => day.fatG),
    avgCarbsG: average((day) => day.carbsG),
    avgDeviation:
      kcalTarget === null || avgKcal === null ? null : avgKcal - kcalTarget,
    withinNormDays:
      kcalTarget === null
        ? 0
        : logged.filter(
            (day) => Math.abs(day.kcal - kcalTarget) <= NORM_TOLERANCE_KCAL,
          ).length,
  };
}

/**
 * Ряд дат от старой к новой — включая те, в которые человек ничего
 * не записал. Дыры в графике важнее аккуратности: по ним видно, что
 * дневник забросили на неделю, а без них график врёт непрерывностью.
 */
export function dateRange(endDate: string, days: number): string[] {
  const [y, m, d] = endDate.split('-').map(Number);
  const result: string[] = [];

  for (let back = days - 1; back >= 0; back -= 1) {
    const date = new Date(y, m - 1, d - back);
    result.push(
      [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-'),
    );
  }

  return result;
}

/** Наибольшее дневное значение — по нему масштабируется гистограмма */
export function peakKcal(days: DayStat[], kcalTarget: number | null): number {
  const maxDay = days.reduce((max, day) => Math.max(max, day.kcal), 0);
  // Норма участвует в масштабе, иначе её линия уезжает за верх графика
  // в те недели, когда человек ел заметно меньше
  return Math.max(maxDay, kcalTarget ?? 0, 1);
}
