import type { Sex, BodyType } from '@/db/schema';

/* ────────────────────────── Процент жира ───────────────────────────── */

export interface BodyFatInput {
  sex: Sex;
  heightCm: number;
  neckCm: number;
  waistCm: number;
  /** Обязателен для женщин — входит в формулу */
  hipCm?: number | null;
}

/**
 * Процент жира по методу US Navy (метрическая версия, все обхваты в см).
 *
 * Мужчины:  495 / (1.0324 − 0.19077·lg(талия − шея) + 0.15456·lg(рост)) − 450
 * Женщины:  495 / (1.29579 − 0.35004·lg(талия + бёдра − шея) + 0.22100·lg(рост)) − 450
 *
 * Точность метода ±3–4% против гидростатического взвешивания — этого
 * достаточно, чтобы отслеживать динамику, но недостаточно, чтобы называть
 * абсолютное число медицинским фактом. Показывать пользователю стоит
 * прежде всего изменение, а не саму цифру.
 *
 * @returns процент жира, либо null если исходные обхваты невалидны
 */
export function calcBodyFatPct(input: BodyFatInput): number | null {
  const { sex, heightCm, neckCm, waistCm, hipCm } = input;

  if (heightCm <= 0 || neckCm <= 0 || waistCm <= 0) return null;

  let raw: number;

  if (sex === 'male') {
    // Логарифм от неположительного числа не определён: у мужчины талия
    // всегда должна быть больше обхвата шеи, иначе замер сделан неверно.
    const girth = waistCm - neckCm;
    if (girth <= 0) return null;

    raw =
      495 /
        (1.0324 -
          0.19077 * Math.log10(girth) +
          0.15456 * Math.log10(heightCm)) -
      450;
  } else {
    if (hipCm == null || hipCm <= 0) return null;

    const girth = waistCm + hipCm - neckCm;
    if (girth <= 0) return null;

    raw =
      495 /
        (1.29579 -
          0.35004 * Math.log10(girth) +
          0.221 * Math.log10(heightCm)) -
      450;
  }

  // Формула — регрессия, обученная на нормальном диапазоне. За его пределами
  // она выдаёт бессмыслицу (отрицательные значения либо 60%+), поэтому
  // результат вне физиологичных границ считаем ошибкой замера.
  if (!Number.isFinite(raw) || raw < 3 || raw > 65) return null;

  return Math.round(raw * 10) / 10;
}

/** Сухая масса тела, кг */
export function calcLeanBodyMass(
  weightKg: number,
  bodyFatPct: number,
): number {
  return Math.round(weightKg * (1 - bodyFatPct / 100) * 10) / 10;
}

/* ──────────────────── Тип телосложения (каркас) ─────────────────────── */

/**
 * Пороги индекса Соловьёва по обхвату запястья, см.
 * Запястье выбрано опорным замером, потому что там почти нет мышц и жира:
 * цифра отражает толщину костяка и не меняется ни от диеты, ни от тренировок.
 */
const WRIST_THRESHOLDS: Record<Sex, { thin: number; wide: number }> = {
  male: { thin: 18, wide: 20 },
  female: { thin: 15, wide: 17 },
};

/**
 * Пороги по обхвату щиколотки, см. В отличие от запястья, это метрика
 * фитнес-традиции без общепринятой нормировки, поэтому используется только
 * как уточнение, когда запястье попало ровно на границу.
 */
const ANKLE_THRESHOLDS: Record<Sex, { thin: number; wide: number }> = {
  male: { thin: 21, wide: 24 },
  female: { thin: 19, wide: 22 },
};

function classify(
  value: number,
  { thin, wide }: { thin: number; wide: number },
): BodyType {
  if (value < thin) return 'ectomorph';
  if (value > wide) return 'endomorph';
  return 'mesomorph';
}

export interface BodyTypeResult {
  bodyType: BodyType;
  /** false, если щиколотка противоречит запястью — стоит показать оговорку */
  isConsistent: boolean;
}

/**
 * Определяет соматотип по каркасу скелета.
 *
 * Оговорка, которую стоит донести и до пользователя: соматотип — грубая
 * характеристика. Он влияет на оценку «идеального веса» и на ожидания от
 * темпа набора, но не участвует в расчёте нормы калорий. Норму задают
 * рост, вес, возраст, пол и активность.
 *
 * @param wristCm  обхват запястья — основной сигнал
 * @param ankleCm  обхват щиколотки — уточняющий, необязателен
 */
export function calcBodyType(
  sex: Sex,
  wristCm: number | null | undefined,
  ankleCm?: number | null,
): BodyTypeResult | null {
  if (wristCm == null || wristCm <= 0) return null;

  const byWrist = classify(wristCm, WRIST_THRESHOLDS[sex]);

  if (ankleCm == null || ankleCm <= 0) {
    return { bodyType: byWrist, isConsistent: true };
  }

  const byAnkle = classify(ankleCm, ANKLE_THRESHOLDS[sex]);

  return { bodyType: byWrist, isConsistent: byWrist === byAnkle };
}

/* ────────────────────── Вспомогательные величины ───────────────────── */

/** Полных лет на указанную дату */
export function calcAge(birthDate: Date | string, on: Date = new Date()): number {
  const b = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  let age = on.getFullYear() - b.getFullYear();
  const monthDiff = on.getMonth() - b.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && on.getDate() < b.getDate())) {
    age -= 1;
  }
  return age;
}

/** Индекс массы тела */
export function calcBmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}

/**
 * Скользящее среднее веса.
 *
 * Показывать пользователю сырой ежедневный вес — верный способ его
 * демотивировать: колебания воды дают ±1–1.5 кг за сутки и полностью
 * маскируют реальный тренд при дефиците в 0.5 кг/неделю.
 *
 * @param logs   записи веса, произвольный порядок
 * @param window размер окна в днях
 */
export function movingAverageWeight(
  logs: { loggedOn: string; weightKg: number }[],
  window = 7,
): { date: string; raw: number; average: number }[] {
  const sorted = [...logs].sort((a, b) => a.loggedOn.localeCompare(b.loggedOn));

  return sorted.map((log, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = sorted.slice(from, i + 1);
    const sum = slice.reduce((acc, l) => acc + l.weightKg, 0);
    return {
      date: log.loggedOn,
      raw: log.weightKg,
      average: Math.round((sum / slice.length) * 100) / 100,
    };
  });
}
