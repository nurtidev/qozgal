/**
 * Счёт нагрузки в тренировке.
 *
 * Ключевое решение всего раздела: рассчитанный здесь расход энергии
 * НЕ добавляется к дневной норме калорий. Норма считается от TDEE, а TDEE
 * уже включает тренировки через коэффициент активности: «3–5 тренировок
 * в неделю» — это множитель 1.55 к основному обмену. Начислив сверху ещё
 * и расход конкретной тренировки, мы посчитали бы её дважды — человек
 * «заработал» бы 400 ккал, которые ему уже начислены, и месяц не увидел
 * бы результата при формально соблюдённом дефиците.
 *
 * Поэтому расход показывается справочно, а на норму влияет только смена
 * образа жизни в профиле.
 */

/** Подход без веса или без повторов в тоннаж не входит: считать нечего */
export function setVolume(
  weightKg: number | null | undefined,
  reps: number | null | undefined,
): number {
  if (!weightKg || !reps) return 0;
  return weightKg * reps;
}

/**
 * Тоннаж тренировки — суммарный поднятый вес.
 *
 * Главная цифра прогресса в силовой работе: она растёт и когда добавили
 * вес на штангу, и когда сделали лишний повтор с прежним. Рекорд в одном
 * подходе такого не показывает — он может стоять месяцами, пока объём
 * работы растёт.
 */
export function sessionVolume(
  sets: { weightKg: number | null; reps: number | null }[],
): number {
  return Math.round(
    sets.reduce((sum, set) => sum + setVolume(set.weightKg, set.reps), 0),
  );
}

/**
 * Оценка расхода по MET: ккал = MET × вес(кг) × часы.
 *
 * Формула грубая по своей природе: MET задаёт тип нагрузки, а не конкретное
 * упражнение, и реальный расход в силовой тренировке зависит от длины пауз
 * между подходами сильнее, чем от выбора движений. Поэтому результат — это
 * порядок величины, и показывать его стоит именно так.
 *
 * @returns null, если считать не от чего: нет длительности, веса тела
 *          или у упражнений не проставлен MET
 */
export function estimateBurnKcal(
  averageMet: number | null,
  bodyWeightKg: number | null,
  durationMin: number | null,
): number | null {
  if (!averageMet || !bodyWeightKg || !durationMin) return null;
  return Math.round(averageMet * bodyWeightKg * (durationMin / 60));
}

/**
 * Прошлый результат по упражнению — то, от чего человек отталкивается
 * в подходе сегодня. Без него журнал превращается в архив, который никто
 * не открывает: смысл записи в том, чтобы в следующий раз сделать больше.
 */
export function bestSet(
  sets: { weightKg: number | null; reps: number | null }[],
): { weightKg: number; reps: number } | null {
  let best: { weightKg: number; reps: number } | null = null;

  for (const set of sets) {
    if (!set.weightKg || !set.reps) continue;
    // Лучшим считаем подход с наибольшим весом, а при равном весе —
    // с большим числом повторов
    if (
      !best ||
      set.weightKg > best.weightKg ||
      (set.weightKg === best.weightKg && set.reps > best.reps)
    ) {
      best = { weightKg: set.weightKg, reps: set.reps };
    }
  }

  return best;
}
