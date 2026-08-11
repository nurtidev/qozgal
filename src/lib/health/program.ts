/**
 * Сборка программы тренировок.
 *
 * Программу собирает таблица, а не модель — по той же причине, что и всё
 * остальное в приложении, но с самой высокой ценой ошибки из всех.
 * Сгенерированная программа невоспроизводима: сегодня модель учла больное
 * плечо и предложила жим гантелей, завтра на тот же запрос выдаст жим стоя
 * со штангой. В дневнике питания такая невоспроизводимость стоит трёхсот
 * килокалорий, здесь — человек делает движение, которого ему делать нельзя,
 * и узнаёт об этом от собственной спины.
 *
 * Поэтому здесь всё детерминировано: шаблон сплита по числу дней, слоты
 * по паттернам движения, подбор упражнения из справочника по разметке.
 * Одинаковый вход даёт одинаковый выход — это проверяется тестом.
 *
 * Что делает фильтр травм. При ручном выборе упражнения приложение только
 * предупреждает и не прячет ничего: там выбирает человек, и запрет он обошёл
 * бы мимо приложения. Здесь наоборот — выбирает приложение, и предложить
 * движение, которое ложится на больное место, оно не вправе. Поэтому
 * упражнение с конфликтом уровня «болит» или «врач запретил» в программу
 * не попадает, а «беспокоит» берётся только когда чистой замены нет —
 * и помечается.
 *
 * Если замены нет вообще, слот выпадает и попадает в skipped. Молча собрать
 * программу без вертикального жима — значит соврать, что она полная.
 */

import {
  conflictsFor,
  worstSeverity,
  type ActiveInjury,
  type BodyArea,
} from './injury';

/** Паттерн движения — см. колонку pattern в справочнике упражнений */
export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'h_push'
  | 'v_push'
  | 'h_pull'
  | 'v_pull'
  | 'chest_iso'
  | 'delt_iso'
  | 'biceps'
  | 'triceps'
  | 'quad_iso'
  | 'ham_iso'
  | 'calf'
  | 'core'
  | 'cardio';

export type DayFocus =
  | 'full_a'
  | 'full_b'
  | 'full_c'
  | 'push'
  | 'pull'
  | 'legs'
  | 'upper_a'
  | 'lower_a'
  | 'upper_b'
  | 'lower_b';

/** Где занимается человек — от этого зависит доступный инвентарь */
export type Place = 'gym' | 'home';

/**
 * Опыт. Берётся не отдельным вопросом, а из активности профиля: человек
 * уже ответил, сколько тренируется в неделю, и переспрашивать то же самое
 * другими словами — лишний шаг в онбординге ради того же знания.
 */
export type Level = 'novice' | 'regular';

export type ProgramGoal = 'lose' | 'maintain' | 'gain';

/** Карточка справочника — ровно то, что нужно подбору */
export interface ExerciseCard {
  id: string;
  nameRu: string;
  pattern: string | null;
  equipment: string | null;
  loadsAreas: string[] | null;
}

export interface PlannedExercise {
  exerciseId: string;
  nameRu: string;
  pattern: MovementPattern;
  sets: number;
  repMin: number | null;
  repMax: number | null;
  /** Кардио меряется минутами: «три подхода бега» не бывает */
  durationMin: number | null;
  restSec: number | null;
  /**
   * Области, которые человек отметил как беспокоящие. Непустой список —
   * чистой замены не нашлось, упражнение оставлено с пометкой.
   */
  caution: BodyArea[];
}

export interface ProgramDay {
  dayIndex: number;
  focus: DayFocus;
  exercises: PlannedExercise[];
}

/** Слот, который не удалось заполнить, и честная причина */
export interface SkippedSlot {
  pattern: MovementPattern;
  /** injury — все варианты задевают больное место; equipment — нет инвентаря */
  reason: 'injury' | 'equipment';
  areas: BodyArea[];
}

export interface Program {
  daysPerWeek: number;
  days: ProgramDay[];
  skipped: SkippedSlot[];
}

export interface ProgramInput {
  daysPerWeek: number;
  place: Place;
  goal: ProgramGoal;
  level: Level;
  exercises: ExerciseCard[];
  injuries: ActiveInjury[];
}

/* ─────────────────────────── Шаблоны сплитов ───────────────────────── */

/**
 * Какой сплит на сколько дней.
 *
 * Новичку три дня даются как три тренировки на всё тело, а не как
 * «жим / тяга / ноги»: пока веса небольшие, каждая группа успевает
 * восстановиться, и три касания в неделю дают прогресс быстрее одного.
 * Разделение по группам начинает окупаться, когда нагрузка вырастает.
 */
const SPLITS: Record<number, Record<Level, DayFocus[]>> = {
  2: {
    novice: ['full_a', 'full_b'],
    regular: ['full_a', 'full_b'],
  },
  3: {
    novice: ['full_a', 'full_b', 'full_c'],
    regular: ['push', 'pull', 'legs'],
  },
  4: {
    novice: ['upper_a', 'lower_a', 'upper_b', 'lower_b'],
    regular: ['upper_a', 'lower_a', 'upper_b', 'lower_b'],
  },
  5: {
    novice: ['push', 'pull', 'legs', 'upper_b', 'lower_b'],
    regular: ['push', 'pull', 'legs', 'upper_b', 'lower_b'],
  },
  // Шесть дней — тот же цикл дважды. Фокусы повторяются, упражнения нет:
  // подбор предпочитает ещё не занятые в программе движения
  6: {
    novice: ['push', 'pull', 'legs', 'push', 'pull', 'legs'],
    regular: ['push', 'pull', 'legs', 'push', 'pull', 'legs'],
  },
};

/**
 * Из чего состоит день. Порядок важен: тяжёлое многосуставное идёт первым,
 * пока есть силы, изоляция и кор — в конец. Лишние слоты отсекаются по
 * уровню, поэтому список длиннее, чем нужно новичку.
 */
const DAY_SLOTS: Record<DayFocus, MovementPattern[]> = {
  full_a: ['squat', 'h_push', 'h_pull', 'core', 'delt_iso'],
  full_b: ['hinge', 'v_push', 'v_pull', 'core', 'calf'],
  full_c: ['lunge', 'h_push', 'h_pull', 'core', 'biceps'],
  push: ['h_push', 'v_push', 'chest_iso', 'triceps', 'delt_iso', 'core'],
  pull: ['v_pull', 'h_pull', 'hinge', 'biceps', 'delt_iso', 'core'],
  legs: ['squat', 'hinge', 'lunge', 'quad_iso', 'ham_iso', 'calf'],
  upper_a: ['h_push', 'h_pull', 'v_push', 'v_pull', 'biceps', 'triceps'],
  lower_a: ['squat', 'hinge', 'lunge', 'calf', 'core'],
  upper_b: ['v_push', 'v_pull', 'h_push', 'h_pull', 'delt_iso', 'triceps'],
  lower_b: ['hinge', 'squat', 'ham_iso', 'quad_iso', 'core'],
};

/** Сколько упражнений в дне. Новичку короче: важнее прийти во второй раз */
const SLOTS_PER_DAY: Record<Level, number> = { novice: 4, regular: 6 };

/**
 * Инвентарь по месту занятий. Порядок задаёт и допустимость, и предпочтение:
 * в зале базовое движение лучше делать со штангой, дома выбор всё равно
 * между гантелями и собственным весом.
 */
const EQUIPMENT_BY_PLACE: Record<Place, string[]> = {
  gym: ['штанга', 'тренажёр', 'гантели', 'брусья', 'турник', 'скакалка', 'без инвентаря'],
  home: ['гантели', 'без инвентаря', 'турник', 'скакалка'],
};

type Role = 'base' | 'accessory' | 'core' | 'cardio';

const ROLE: Record<MovementPattern, Role> = {
  squat: 'base',
  hinge: 'base',
  lunge: 'base',
  h_push: 'base',
  v_push: 'base',
  h_pull: 'base',
  v_pull: 'base',
  chest_iso: 'accessory',
  delt_iso: 'accessory',
  biceps: 'accessory',
  triceps: 'accessory',
  quad_iso: 'accessory',
  ham_iso: 'accessory',
  calf: 'accessory',
  core: 'core',
  cardio: 'cardio',
};

/**
 * Подходы, повторы и отдых по цели.
 *
 * Разница между целями — в объёме, а не в «режиме жиросжигания». Жир уходит
 * от дефицита, который считается в дневнике; количество повторов на это
 * не влияет никак, и программа «на рельеф» из пятнадцати повторов — миф.
 * На дефиците урезан объём (меньше подходов, короче отдых), но рабочий вес
 * держится прежним: именно он говорит телу, что мышцы нужны, и без него
 * человек худеет вместе с ними. На профиците наоборот — объёма больше,
 * потому что есть из чего восстанавливаться.
 */
const PRESCRIPTION: Record<
  ProgramGoal,
  Record<Exclude<Role, 'cardio'>, { sets: number; repMin: number; repMax: number; restSec: number }>
> = {
  gain: {
    base: { sets: 4, repMin: 6, repMax: 8, restSec: 150 },
    accessory: { sets: 3, repMin: 8, repMax: 12, restSec: 90 },
    core: { sets: 3, repMin: 10, repMax: 15, restSec: 60 },
  },
  maintain: {
    base: { sets: 3, repMin: 8, repMax: 10, restSec: 120 },
    accessory: { sets: 3, repMin: 10, repMax: 12, restSec: 75 },
    core: { sets: 3, repMin: 12, repMax: 15, restSec: 45 },
  },
  lose: {
    base: { sets: 3, repMin: 6, repMax: 10, restSec: 120 },
    accessory: { sets: 3, repMin: 10, repMax: 12, restSec: 60 },
    core: { sets: 3, repMin: 12, repMax: 20, restSec: 45 },
  },
};

/** Кардио в конце дня — только при снижении веса */
const CARDIO_MIN: Record<Level, number> = { novice: 15, regular: 20 };

const MIN_DAYS = 2;
const MAX_DAYS = 6;

/* ──────────────────────────────── Сборка ───────────────────────────── */

export function buildProgram(input: ProgramInput): Program {
  const daysPerWeek = Math.min(Math.max(input.daysPerWeek, MIN_DAYS), MAX_DAYS);
  const focuses = SPLITS[daysPerWeek][input.level];
  const allowed = EQUIPMENT_BY_PLACE[input.place];

  /**
   * Сколько раз упражнение уже занято в программе. Нужно, чтобы шесть дней
   * не превратились в один и тот же день шесть раз: при равных прочих
   * подбор берёт то, что ещё не использовано.
   */
  const used = new Map<string, number>();
  const skipped: SkippedSlot[] = [];

  const days: ProgramDay[] = focuses.map((focus, index) => {
    const patterns = DAY_SLOTS[focus].slice(0, SLOTS_PER_DAY[input.level]);
    if (input.goal === 'lose') patterns.push('cardio');

    const exercises: PlannedExercise[] = [];

    for (const pattern of patterns) {
      const picked = pick(pattern, input, allowed, used, exercises);

      if (!picked) continue;
      if ('reason' in picked) {
        // Один и тот же непокрытый слот в разных днях повторять незачем:
        // причина одна, и список из шести одинаковых строк её не усилит
        if (!skipped.some((s) => s.pattern === pattern && s.reason === picked.reason)) {
          skipped.push(picked);
        }
        continue;
      }

      used.set(picked.exerciseId, (used.get(picked.exerciseId) ?? 0) + 1);
      exercises.push(picked);
    }

    return { dayIndex: index + 1, focus, exercises };
  });

  return { daysPerWeek, days, skipped };
}

interface Ranked {
  card: ExerciseCard;
  caution: BodyArea[];
}

/**
 * Отсев по травмам — общий для сборки программы и для замены упражнения.
 *
 * Строгость здесь выше, чем при ручном выборе упражнения человеком, и это
 * осознанно: «болит» и «врач запретил» исключают движение совсем, «беспокоит»
 * берётся только когда чистой замены в этом паттерне нет. При ручном выборе
 * решает человек, а здесь предлагает приложение — предложить движение
 * на больное место оно не вправе.
 */
function allowedByInjuries(
  cards: ExerciseCard[],
  injuries: ActiveInjury[],
): { pool: Ranked[]; blockedAreas: BodyArea[] } {
  const clean: Ranked[] = [];
  const cautious: Ranked[] = [];
  const blocked = new Set<BodyArea>();

  for (const card of cards) {
    const conflicts = conflictsFor(card.loadsAreas, injuries);
    const worst = worstSeverity(conflicts);

    if (worst === 'pain' || worst === 'medical') {
      for (const c of conflicts) blocked.add(c.area);
      continue;
    }

    if (worst === 'watch') {
      cautious.push({ card, caution: conflicts.map((c) => c.area) });
      continue;
    }

    clean.push({ card, caution: [] });
  }

  return {
    pool: clean.length > 0 ? clean : cautious,
    blockedAreas: [...blocked],
  };
}

/**
 * Подбор упражнения под слот.
 *
 * @returns упражнение, причину пропуска или null, если слот и так занят
 */
function pick(
  pattern: MovementPattern,
  input: ProgramInput,
  allowed: string[],
  used: Map<string, number>,
  already: PlannedExercise[],
): PlannedExercise | SkippedSlot | null {
  const available = input.exercises.filter(
    (e) =>
      e.pattern === pattern &&
      e.equipment !== null &&
      allowed.includes(e.equipment) &&
      // Дважды одно и то же упражнение в одном дне — не программа, а опечатка
      !already.some((p) => p.exerciseId === e.id),
  );

  if (available.length === 0) {
    const knownAtPlace = input.exercises.some(
      (e) => e.pattern === pattern && e.equipment && allowed.includes(e.equipment),
    );
    // Ничего подходящего в справочнике нет — это про инвентарь, и человеку
    // стоит об этом сказать. А если варианты есть, но все уже заняты в этом
    // же дне, день просто получится короче: жаловаться не на что
    return knownAtPlace ? null : { pattern, reason: 'equipment', areas: [] };
  }

  const { pool, blockedAreas } = allowedByInjuries(available, input.injuries);

  if (pool.length === 0) {
    return { pattern, reason: 'injury', areas: blockedAreas };
  }

  const best = pool
    .map((ranked, order) => ({
      ranked,
      // Порядок сравнения: сперва то, что ещё не занято в программе, затем
      // предпочтительный инвентарь, затем порядок справочника — он и делает
      // подбор воспроизводимым, без единого случайного числа
      key: [
        used.get(ranked.card.id) ?? 0,
        equipmentRank(ranked.card.equipment, allowed),
        order,
      ] as const,
    }))
    .sort((a, b) => compareKeys(a.key, b.key))[0].ranked;

  return {
    exerciseId: best.card.id,
    nameRu: best.card.nameRu,
    pattern,
    caution: best.caution,
    ...prescribe(pattern, input.goal, input.level),
  };
}

/* ─────────────────────── Замена одного упражнения ──────────────────── */

export interface AlternativeInput {
  pattern: MovementPattern;
  /** Что стоит в слоте сейчас — от него отсчитывается «следующее» */
  currentId: string;
  exercises: ExerciseCard[];
  place: Place;
  injuries: ActiveInjury[];
  /** Что уже стоит в этом же дне: одно движение дважды — не программа */
  takenIds: string[];
}

export interface Alternative {
  exerciseId: string;
  nameRu: string;
  /** Области, которые движение задевает на уровне «беспокоит» */
  caution: BodyArea[];
}

/**
 * Следующее упражнение того же паттерна.
 *
 * Зачем нужно: тренажёр занят, движение незнакомо, плечо хрустит именно
 * на этом жиме. Без замены у человека остаётся выбор между «пересобрать
 * всю программу» и «уйти в свободную тренировку», то есть между потерей
 * привычной программы и отказом от неё, — и он уходит молча.
 *
 * Обход циклический: каждое нажатие даёт следующий вариант по тому же
 * порядку предпочтения, каким собиралась программа, а после последнего
 * возвращает к первому. Иначе кнопка перебирала бы два варианта туда-сюда:
 * «лучшее из оставшихся» после исключения текущего снова указывает
 * на предыдущее.
 *
 * Паттерн не меняется, поэтому подходы, повторы и отдых остаются те же —
 * заменяется движение, а не место дня в программе.
 *
 * @returns следующий вариант или null, если выбора нет
 */
export function nextAlternative(input: AlternativeInput): Alternative | null {
  const allowed = EQUIPMENT_BY_PLACE[input.place];

  const available = input.exercises.filter(
    (e) =>
      e.pattern === input.pattern &&
      e.equipment !== null &&
      allowed.includes(e.equipment) &&
      // Текущее оставляем в списке: по нему находится место в кругу
      (e.id === input.currentId || !input.takenIds.includes(e.id)),
  );

  const { pool } = allowedByInjuries(available, input.injuries);
  if (pool.length === 0) return null;

  const ordered = pool
    .map((ranked, order) => ({
      ranked,
      key: [equipmentRank(ranked.card.equipment, allowed), order] as const,
    }))
    .sort((a, b) => compareKeys(a.key, b.key))
    .map((entry) => entry.ranked);

  const at = ordered.findIndex((r) => r.card.id === input.currentId);

  /**
   * Текущего в списке может не быть: например, оно шло с пометкой
   * «беспокоит», а потом в этом же паттерне появилось чистое движение —
   * тогда пул состоит из чистых, и заменять надо на первое из них.
   */
  if (at === -1) {
    const first = ordered[0];
    return {
      exerciseId: first.card.id,
      nameRu: first.card.nameRu,
      caution: first.caution,
    };
  }

  if (ordered.length < 2) return null;

  const next = ordered[(at + 1) % ordered.length];
  return {
    exerciseId: next.card.id,
    nameRu: next.card.nameRu,
    caution: next.caution,
  };
}

function equipmentRank(equipment: string | null, allowed: string[]): number {
  const index = equipment ? allowed.indexOf(equipment) : -1;
  return index < 0 ? allowed.length : index;
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** Подходы и повторы под роль движения; кардио считается минутами */
function prescribe(
  pattern: MovementPattern,
  goal: ProgramGoal,
  level: Level,
): Pick<PlannedExercise, 'sets' | 'repMin' | 'repMax' | 'durationMin' | 'restSec'> {
  const role = ROLE[pattern];

  if (role === 'cardio') {
    return {
      sets: 1,
      repMin: null,
      repMax: null,
      durationMin: CARDIO_MIN[level],
      restSec: null,
    };
  }

  const base = PRESCRIPTION[goal][role];

  return {
    // Новичку четвёртый подход в базовом движении не нужен: техника
    // разъезжается раньше, чем кончаются мышцы
    sets: level === 'novice' ? Math.min(base.sets, 3) : base.sets,
    repMin: base.repMin,
    repMax: base.repMax,
    durationMin: null,
    restSec: base.restSec,
  };
}

/**
 * Уровень по коэффициенту активности из профиля.
 *
 * Сидячий образ жизни и «1–3 тренировки» — человек в зале либо впервые,
 * либо ходит нерегулярно; в обоих случаях объём стоит начинать с меньшего.
 */
export function levelFromActivity(activity: string): Level {
  return activity === 'sedentary' || activity === 'light' ? 'novice' : 'regular';
}
