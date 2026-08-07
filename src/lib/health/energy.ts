import type { Sex, ActivityLevel } from '@/db/schema';
import { calcLeanBodyMass } from './composition';

/* ─────────────────────── Базовый обмен (BMR) ───────────────────────── */

export interface BmrInput {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
  /** Если известен, расчёт идёт по Katch-McArdle — он точнее */
  bodyFatPct?: number | null;
}

export interface BmrResult {
  kcal: number;
  formula: 'mifflin-st-jeor' | 'katch-mcardle';
}

/**
 * Базовый обмен — сколько тело тратит в полном покое.
 *
 * Формула выбирается по наличию данных о составе тела:
 *
 * • Katch-McArdle — 370 + 21.6 × сухая масса. Точнее, потому что жировая
 *   ткань почти не потребляет энергию, и два человека одного веса с разным
 *   процентом жира имеют разный обмен. Требует замеров обхватов.
 *
 * • Mifflin-St Jeor — работает от роста, веса, возраста и пола. Фолбэк,
 *   когда обхваты ещё не сняты. Сегодня это стандарт по умолчанию,
 *   он заметно точнее устаревшей формулы Харриса-Бенедикта.
 */
export function calcBmr(input: BmrInput): BmrResult {
  const { sex, weightKg, heightCm, age, bodyFatPct } = input;

  if (bodyFatPct != null && bodyFatPct > 0) {
    const lbm = calcLeanBodyMass(weightKg, bodyFatPct);
    return {
      kcal: Math.round(370 + 21.6 * lbm),
      formula: 'katch-mcardle',
    };
  }

  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const kcal = sex === 'male' ? base + 5 : base - 161;

  return { kcal: Math.round(kcal), formula: 'mifflin-st-jeor' };
}

/* ──────────────────── Суточный расход (TDEE) ───────────────────────── */

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  athlete: 1.9,
};

/** Полный суточный расход = базовый обмен × коэффициент активности */
export function calcTdee(bmrKcal: number, activity: ActivityLevel): number {
  return Math.round(bmrKcal * ACTIVITY_MULTIPLIERS[activity]);
}

/* ──────────────────────── Норма калорий ────────────────────────────── */

export type GoalType = 'lose' | 'maintain' | 'gain';

/** Примерно столько энергии содержит килограмм жировой ткани */
const KCAL_PER_KG_FAT = 7700;

/** Дефицит глубже этого приводит к потере мышц и срывам */
const MAX_DEFICIT_RATIO = 0.25;
/** Профицит сверх этого уходит преимущественно в жир */
const MAX_SURPLUS_RATIO = 0.2;

/** Абсолютный пол калорийности — ниже уже дефицит микронутриентов */
const ABSOLUTE_FLOOR: Record<Sex, number> = { male: 1500, female: 1200 };

export interface CalorieTargetInput {
  tdee: number;
  bmr: number;
  sex: Sex;
  weightKg: number;
  goalType: GoalType;
  /** Желаемый темп в кг/неделю, всегда положительное число */
  weeklyRateKg?: number;
}

/**
 * Что пришлось урезать — стоит показать пользователю, а не молча подменить.
 *
 * Код, а не готовая фраза: сервер не знает языка интерфейса, тексты живут
 * в словарях Mini App. Русская строка отсюда доехала бы до казахского
 * экрана как есть.
 */
export type Adjustment =
  | { code: 'deficitCapped' }
  | { code: 'surplusCapped' }
  | { code: 'raisedToBmr' }
  | { code: 'raisedToFloor'; kcal: number };

export interface CalorieTargetResult {
  kcal: number;
  /** Отрицательное — дефицит, положительное — профицит */
  dailyDelta: number;
  /** Реально достижимый темп после применения ограничений, кг/неделю */
  effectiveWeeklyRateKg: number;
  adjustments: Adjustment[];
}

/**
 * Дневная норма калорий под цель.
 *
 * Запрошенный темп последовательно ограничивается тремя правилами, и каждое
 * срабатывание попадает в adjustments — пользователь должен понимать, почему
 * получил не ту цифру, которую просил:
 *
 *  1. потолок по доле от TDEE — 25% на дефицит, 20% на профицит;
 *  2. норма не опускается ниже базового обмена;
 *  3. абсолютный минимум 1500/1200 ккал.
 */
export function calcCalorieTarget(
  input: CalorieTargetInput,
): CalorieTargetResult {
  const { tdee, bmr, sex, goalType, weeklyRateKg } = input;
  const adjustments: Adjustment[] = [];

  if (goalType === 'maintain') {
    return {
      kcal: tdee,
      dailyDelta: 0,
      effectiveWeeklyRateKg: 0,
      adjustments,
    };
  }

  const requestedRate = weeklyRateKg ?? (goalType === 'lose' ? 0.5 : 0.25);
  const requestedDelta = (requestedRate * KCAL_PER_KG_FAT) / 7;

  const cap = goalType === 'lose' ? tdee * MAX_DEFICIT_RATIO : tdee * MAX_SURPLUS_RATIO;

  const delta = Math.min(requestedDelta, cap);
  if (delta < requestedDelta) {
    adjustments.push({
      code: goalType === 'lose' ? 'deficitCapped' : 'surplusCapped',
    });
  }

  let kcal = goalType === 'lose' ? tdee - delta : tdee + delta;

  if (goalType === 'lose') {
    if (kcal < bmr) {
      kcal = bmr;
      adjustments.push({ code: 'raisedToBmr' });
    }
    const floor = ABSOLUTE_FLOOR[sex];
    if (kcal < floor) {
      kcal = floor;
      adjustments.push({ code: 'raisedToFloor', kcal: floor });
    }
  }

  const finalDelta = kcal - tdee;
  const effectiveWeeklyRateKg =
    Math.round((Math.abs(finalDelta) * 7 * 100) / KCAL_PER_KG_FAT) / 100;

  return {
    kcal: Math.round(kcal),
    dailyDelta: Math.round(finalDelta),
    effectiveWeeklyRateKg,
    adjustments,
  };
}

/* ─────────────────────────────── БЖУ ───────────────────────────────── */

export interface MacroTargets {
  proteinG: number;
  fatG: number;
  carbsG: number;
}

const KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 } as const;

/**
 * Раскладка нормы по белкам, жирам и углеводам.
 *
 * Порядок расчёта не случаен: сначала белок, потом жир, углеводы получают
 * остаток. Белок и жир имеют физиологический минимум, углеводы — нет.
 *
 * • Белок считается от сухой массы, если она известна: жировой ткани белок
 *   не нужен, и у человека с 35% жира расчёт «на общий вес» завышает норму.
 *   На дефиците белок поднимается — он защищает мышцы, когда энергии не хватает.
 * • Жир не опускается ниже 0.8 г/кг веса: это порог, ниже которого страдает
 *   синтез половых гормонов и усвоение жирорастворимых витаминов.
 */
export function calcMacroTargets(
  kcal: number,
  weightKg: number,
  goalType: GoalType,
  bodyFatPct?: number | null,
): MacroTargets {
  const lbm =
    bodyFatPct != null && bodyFatPct > 0
      ? calcLeanBodyMass(weightKg, bodyFatPct)
      : null;

  const proteinPerKg = goalType === 'lose' ? 2.2 : 1.8;
  const proteinG = Math.round((lbm ?? weightKg) * proteinPerKg);

  const fatByRatio = (kcal * (goalType === 'lose' ? 0.25 : 0.3)) / KCAL_PER_G.fat;
  const fatFloor = weightKg * 0.8;
  const fatG = Math.round(Math.max(fatByRatio, fatFloor));

  const remaining =
    kcal - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat;

  // При очень низкой норме и высоком весе белок с жиром способны выбрать всю
  // калорийность. Отрицательные углеводы — сигнал, что цель нереалистична;
  // отдаём ноль, а предупреждение пользователь получает из adjustments выше.
  const carbsG = Math.max(0, Math.round(remaining / KCAL_PER_G.carbs));

  return { proteinG, fatG, carbsG };
}

/* ───────────────────── Всё вместе, одним вызовом ───────────────────── */

export interface DailyPlanInput {
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goalType: GoalType;
  weeklyRateKg?: number;
  bodyFatPct?: number | null;
}

export interface DailyPlan {
  bmr: number;
  bmrFormula: BmrResult['formula'];
  tdee: number;
  kcalTarget: number;
  dailyDelta: number;
  effectiveWeeklyRateKg: number;
  macros: MacroTargets;
  adjustments: Adjustment[];
}

/** Полный расчёт дневной нормы: обмен → расход → цель → БЖУ */
export function buildDailyPlan(input: DailyPlanInput): DailyPlan {
  const { sex, age, heightCm, weightKg, activity, goalType, weeklyRateKg, bodyFatPct } =
    input;

  const bmr = calcBmr({ sex, weightKg, heightCm, age, bodyFatPct });
  const tdee = calcTdee(bmr.kcal, activity);

  const target = calcCalorieTarget({
    tdee,
    bmr: bmr.kcal,
    sex,
    weightKg,
    goalType,
    weeklyRateKg,
  });

  const macros = calcMacroTargets(target.kcal, weightKg, goalType, bodyFatPct);

  return {
    bmr: bmr.kcal,
    bmrFormula: bmr.formula,
    tdee,
    kcalTarget: target.kcal,
    dailyDelta: target.dailyDelta,
    effectiveWeeklyRateKg: target.effectiveWeeklyRateKg,
    macros,
    adjustments: target.adjustments,
  };
}
