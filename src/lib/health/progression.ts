import type { MovementPattern } from './program';

/**
 * Что делать с весом в следующий раз.
 *
 * Правила детерминированные и объяснимые — по той же причине, по которой
 * таблицей собирается сама программа. «Прибавь 2.5 кг, потому что три
 * тренировки подряд ты делал десять повторов из диапазона восемь-десять» —
 * это можно проверить и оспорить. Сгенерированный совет проверить нельзя,
 * а на штанге он превращается в травму.
 *
 * Здесь только суждение, без базы: на вход идёт история подходов и ответ
 * человека о том, как прошла тренировка.
 *
 * ⚠️ Правила — общая практика, а не заключение специалиста. Их стоит
 * показать тренеру: прогрессия на дефиците и прогрессия на наборе ведут
 * себя по-разному, и цена ошибки здесь выше, чем в подсчёте калорий.
 */

export type Feeling = 'easy' | 'normal' | 'hard' | 'pain';

export interface LoggedSet {
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
}

export interface SessionLog {
  performedOn: string;
  /** Как прошла тренировка целиком */
  feeling: Feeling | null;
  /** Болело именно на этом упражнении */
  painful: boolean;
  sets: LoggedSet[];
}

export interface ProgressionInput {
  pattern: MovementPattern;
  repMin: number;
  repMax: number;
  plannedSets: number;
  /** Тренировки с этим упражнением, свежие первыми */
  history: SessionLog[];
}

export type Advice =
  | {
      kind: 'increase';
      /** На сколько прибавить; null — прибавлять нечего, добавьте повтор */
      deltaKg: number | null;
    }
  | { kind: 'hold' }
  | { kind: 'replace' }
  | null;

/**
 * Сколько тренировок должно подтвердить готовность.
 *
 * Одной мало: человек мог выспаться, поесть и сделать верхнюю границу
 * случайно. Трёх много — на дефиците столько ждать значит не прибавить
 * вообще никогда.
 */
const CONFIRMING_SESSIONS = 2;

/**
 * Шаг прибавки. Для базовых движений — минимальный блин на штанге,
 * для изоляции вдвое меньше: на подъёме на бицепс 2.5 кг это плюс
 * пятнадцать процентов, а не прогрессия.
 */
const STEP_KG: Record<'base' | 'accessory', number> = {
  base: 2.5,
  accessory: 1,
};

const BASE_PATTERNS = new Set<MovementPattern>([
  'squat',
  'hinge',
  'lunge',
  'h_push',
  'v_push',
  'h_pull',
  'v_pull',
]);

/** Выше этого подход был на пределе, и прибавлять рано */
const RPE_CEILING = 8;

/** Ощущение, при котором вес не двигаем даже при выполненном диапазоне */
function heavy(feeling: Feeling | null): boolean {
  return feeling === 'hard';
}

/** Все запланированные подходы сделаны, и в каждом — верхняя граница */
function ceilingReached(session: SessionLog, input: ProgressionInput): boolean {
  const working = session.sets.filter((s) => (s.reps ?? 0) > 0);
  if (working.length < input.plannedSets) return false;

  return working.every((set) => (set.reps ?? 0) >= input.repMax);
}

/** Хотя бы один подход выше потолка тяжести — значит запаса не осталось */
function atLimit(session: SessionLog): boolean {
  return session.sets.some((set) => set.rpe !== null && set.rpe > RPE_CEILING);
}

/** Недобор нижней границы: вес пока не по силам */
function belowFloor(session: SessionLog, input: ProgressionInput): boolean {
  const working = session.sets.filter((s) => (s.reps ?? 0) > 0);
  if (working.length === 0) return false;
  return working.some((set) => (set.reps ?? 0) < input.repMin);
}

/** Работает ли упражнение с весом вообще — у планки и подтягиваний его нет */
function loaded(history: SessionLog[]): boolean {
  return history.some((session) =>
    session.sets.some((set) => (set.weightKg ?? 0) > 0),
  );
}

/**
 * Совет по одному упражнению программы.
 *
 * @returns null, когда сказать нечего: данных мало или картина смешанная.
 *          Молчание здесь лучше совета наугад — человек ему поверит.
 */
export function advise(input: ProgressionInput): Advice {
  const history = input.history.slice(0, CONFIRMING_SESSIONS);

  /**
   * Боль — раньше всего остального и по одному упоминанию за две
   * тренировки. Ждать второго подтверждения нельзя: если движение ложится
   * на больное место, второй раз — это ещё одна тренировка через боль.
   */
  if (history.some((session) => session.painful)) {
    return { kind: 'replace' };
  }

  if (history.length < CONFIRMING_SESSIONS) return null;

  if (history.some((session) => belowFloor(session, input))) {
    return { kind: 'hold' };
  }

  const ready = history.every(
    (session) =>
      ceilingReached(session, input) && !heavy(session.feeling) && !atLimit(session),
  );

  if (!ready) {
    // Диапазон выполнен, но далось тяжело — вес держим, добираем качеством
    const done = history.every((session) => ceilingReached(session, input));
    return done ? { kind: 'hold' } : null;
  }

  return {
    kind: 'increase',
    // Без снаряда прибавлять нечего — растёт число повторов, а не вес
    deltaKg: loaded(history) ? STEP_KG[BASE_PATTERNS.has(input.pattern) ? 'base' : 'accessory'] : null,
  };
}

/**
 * Стоит ли сократить день.
 *
 * Считается по всей тренировке, а не по упражнению: если человек дважды
 * не доделал треть запланированных подходов, дело не в конкретном
 * движении — день длиннее, чем он готов делать. Ходить на две трети
 * тренировки хуже, чем ходить на короткую целиком.
 */
export function overloaded(
  sessions: { plannedSets: number; doneSets: number }[],
): boolean {
  const recent = sessions.slice(0, CONFIRMING_SESSIONS);
  if (recent.length < CONFIRMING_SESSIONS) return false;

  return recent.every(
    (session) =>
      session.plannedSets > 0 && session.doneSets / session.plannedSets < 2 / 3,
  );
}
