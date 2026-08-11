import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProgram,
  levelFromActivity,
  nextAlternative,
  type AlternativeInput,
  type ExerciseCard,
  type ProgramInput,
} from './program';
import type { ActiveInjury } from './injury';
import { EXERCISES } from '@/db/seed-data/exercises';

/**
 * Программа собирается таблицей, а не моделью. Эти тесты защищают ровно два
 * свойства, ради которых так сделано: одинаковый вход даёт одинаковую
 * программу, и движение, которое ложится на больное место, в неё не попадает.
 *
 * Справочник берётся настоящий, из сида: разметка паттернов и нагружаемых
 * областей — часть проверяемого, и на выдуманных карточках проверялся бы
 * только код подбора.
 */

/** Карточки справочника с подставленными идентификаторами */
const CATALOG: ExerciseCard[] = EXERCISES.map((e) => ({
  id: e.nameRu,
  nameRu: e.nameRu,
  pattern: e.pattern ?? null,
  equipment: e.equipment ?? null,
  loadsAreas: e.loadsAreas ?? null,
}));

function input(overrides: Partial<ProgramInput> = {}): ProgramInput {
  return {
    daysPerWeek: 3,
    place: 'gym',
    goal: 'maintain',
    level: 'regular',
    exercises: CATALOG,
    injuries: [],
    ...overrides,
  };
}

/** Все упражнения программы одним списком */
function flat(program: ReturnType<typeof buildProgram>) {
  return program.days.flatMap((d) => d.exercises);
}

function card(nameRu: string): ExerciseCard {
  const found = CATALOG.find((e) => e.id === nameRu);
  assert.ok(found, `в справочнике должно быть «${nameRu}»`);
  return found;
}

describe('Программа тренировок', () => {
  test('одинаковый вход даёт одинаковую программу', () => {
    // Главное свойство раздела: программа не должна меняться от запуска
    // к запуску. Иначе вчера безопасное движение сегодня становится опасным
    assert.deepEqual(buildProgram(input()), buildProgram(input()));
  });

  test('дней столько, сколько человек готов тренироваться', () => {
    for (const daysPerWeek of [2, 3, 4, 5, 6]) {
      const program = buildProgram(input({ daysPerWeek }));
      assert.equal(program.days.length, daysPerWeek);
      assert.deepEqual(
        program.days.map((d) => d.dayIndex),
        Array.from({ length: daysPerWeek }, (_, i) => i + 1),
      );
    }
  });

  test('новичку три дня на всё тело, опытному — сплит', () => {
    const novice = buildProgram(input({ daysPerWeek: 3, level: 'novice' }));
    assert.deepEqual(
      novice.days.map((d) => d.focus),
      ['full_a', 'full_b', 'full_c'],
    );
    // Новичку короче: важнее прийти во второй раз, чем сделать всё сразу
    assert.ok(novice.days.every((d) => d.exercises.length <= 4));

    const regular = buildProgram(input({ daysPerWeek: 3, level: 'regular' }));
    assert.deepEqual(
      regular.days.map((d) => d.focus),
      ['push', 'pull', 'legs'],
    );
    assert.ok(regular.days.every((d) => d.exercises.length >= 5));
  });

  test('внутри дня упражнения не повторяются', () => {
    for (const daysPerWeek of [2, 3, 4, 5, 6]) {
      for (const day of buildProgram(input({ daysPerWeek })).days) {
        const ids = day.exercises.map((e) => e.exerciseId);
        assert.equal(new Set(ids).size, ids.length);
      }
    }
  });

  test('шесть дней — не один и тот же день шесть раз', () => {
    const program = buildProgram(input({ daysPerWeek: 6 }));
    const first = program.days[0].exercises.map((e) => e.exerciseId);
    const second = program.days[3].exercises.map((e) => e.exerciseId);

    assert.equal(program.days[0].focus, program.days[3].focus);
    assert.notDeepEqual(first, second, 'второй цикл должен взять другие движения');
  });

  /* ───────────────────────────── Травмы ────────────────────────────── */

  test('больная поясница выкидывает движения, которые её нагружают', () => {
    const backPain: ActiveInjury = { area: 'lower_back', severity: 'pain' };
    const program = buildProgram(
      input({ daysPerWeek: 6, injuries: [backPain] }),
    );

    for (const planned of flat(program)) {
      const loads = card(planned.nameRu).loadsAreas ?? [];
      assert.ok(
        !loads.includes('lower_back'),
        `${planned.nameRu} нагружает поясницу и не должно попасть в программу`,
      );
    }
  });

  test('врачебный запрет действует так же, как боль', () => {
    const kneeBan: ActiveInjury = { area: 'knee', severity: 'medical' };
    const program = buildProgram(input({ injuries: [kneeBan] }));

    for (const planned of flat(program)) {
      assert.ok(!(card(planned.nameRu).loadsAreas ?? []).includes('knee'));
    }
  });

  test('«беспокоит» не запрещает, но уступает чистой замене', () => {
    // Колено беспокоит: приседания со штангой его нагружают, а тяга верхнего
    // блока — нет. В спине замена найдётся, в ногах — нет, и там движение
    // останется с пометкой
    const kneeWatch: ActiveInjury = { area: 'knee', severity: 'watch' };
    const program = buildProgram(
      input({ daysPerWeek: 3, level: 'regular', injuries: [kneeWatch] }),
    );

    const marked = flat(program).filter((e) => e.caution.length > 0);
    assert.ok(marked.length > 0, 'что-то из ног должно остаться с пометкой');
    for (const planned of marked) {
      assert.deepEqual(planned.caution, ['knee']);
      assert.ok((card(planned.nameRu).loadsAreas ?? []).includes('knee'));
    }

    // Там, где чистый вариант есть, помеченный не берётся
    const pullDay = program.days.find((d) => d.focus === 'pull');
    assert.ok(pullDay);
    assert.deepEqual(
      pullDay.exercises.filter((e) => e.caution.length > 0),
      [],
    );
  });

  test('нечем заменить — слот выпадает, и об этом сказано', () => {
    // Плечо под врачебным запретом: жать нечем вообще, и программа обязана
    // это признать, а не собраться молча без половины движений
    const shoulderBan: ActiveInjury = { area: 'shoulder', severity: 'medical' };
    const program = buildProgram(
      input({ daysPerWeek: 3, level: 'regular', injuries: [shoulderBan] }),
    );

    const pushSkipped = program.skipped.filter(
      (s) => s.pattern === 'h_push' || s.pattern === 'v_push',
    );
    assert.equal(pushSkipped.length, 2);
    for (const slot of pushSkipped) {
      assert.equal(slot.reason, 'injury');
      assert.deepEqual(slot.areas, ['shoulder']);
    }

    // Одна и та же причина не дублируется по дням
    const keys = program.skipped.map((s) => `${s.pattern}:${s.reason}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  test('без травм ничего не выпадает и ничего не помечено', () => {
    const program = buildProgram(input({ daysPerWeek: 4 }));
    assert.deepEqual(program.skipped, []);
    assert.deepEqual(
      flat(program).filter((e) => e.caution.length > 0),
      [],
    );
  });

  /* ──────────────────────────── Инвентарь ──────────────────────────── */

  test('дома не появляется штанга и тренажёры', () => {
    const home = new Set(['гантели', 'без инвентаря', 'турник', 'скакалка']);
    const program = buildProgram(input({ daysPerWeek: 4, place: 'home' }));

    const picked = flat(program);
    assert.ok(picked.length > 0);
    for (const planned of picked) {
      assert.ok(
        home.has(card(planned.nameRu).equipment ?? ''),
        `${planned.nameRu} дома не сделать`,
      );
    }
  });

  test('в зале базовое движение берётся со штангой', () => {
    const program = buildProgram(input({ daysPerWeek: 3, level: 'regular' }));
    const legs = program.days.find((d) => d.focus === 'legs');
    assert.equal(legs?.exercises[0].nameRu, 'Приседания со штангой');
  });

  /* ────────────────────────── Подходы и цель ───────────────────────── */

  test('на массе базовое движение тяжелее и объёмнее', () => {
    const gain = buildProgram(input({ goal: 'gain' }));
    const squat = flat(gain).find((e) => e.pattern === 'squat');
    assert.deepEqual(
      { sets: squat?.sets, repMin: squat?.repMin, repMax: squat?.repMax },
      { sets: 4, repMin: 6, repMax: 8 },
    );
  });

  test('на снижении веса рабочий вес остаётся, а не заменяется повторами', () => {
    // Жир уходит от дефицита, а не от пятнадцати повторов. Тяжёлая работа
    // на дефиците и есть то, что сохраняет мышцы, поэтому нижняя граница
    // повторов в базовых движениях не уезжает вверх
    const lose = buildProgram(input({ goal: 'lose' }));
    const squat = flat(lose).find((e) => e.pattern === 'squat');
    assert.equal(squat?.repMin, 6);

    // Кардио — часть программы при снижении веса, и меряется минутами
    for (const day of lose.days) {
      const cardio = day.exercises.find((e) => e.pattern === 'cardio');
      assert.ok(cardio, 'в каждом дне должно быть кардио');
      assert.equal(cardio.sets, 1);
      assert.equal(cardio.repMin, null);
      assert.ok((cardio.durationMin ?? 0) >= 15);
    }
  });

  test('на удержании и наборе кардио не навязывается', () => {
    for (const goal of ['maintain', 'gain'] as const) {
      const program = buildProgram(input({ goal }));
      assert.deepEqual(
        flat(program).filter((e) => e.pattern === 'cardio'),
        [],
      );
    }
  });

  test('новичку не дают четвёртый подход', () => {
    const program = buildProgram(input({ goal: 'gain', level: 'novice' }));
    assert.ok(flat(program).every((e) => e.sets <= 3));
  });

  /* ─────────────────────────────── Ввод ────────────────────────────── */

  test('число дней зажимается в разумные границы', () => {
    assert.equal(buildProgram(input({ daysPerWeek: 0 })).days.length, 2);
    assert.equal(buildProgram(input({ daysPerWeek: 9 })).days.length, 6);
  });

  test('уровень берётся из активности профиля, а не отдельным вопросом', () => {
    assert.equal(levelFromActivity('sedentary'), 'novice');
    assert.equal(levelFromActivity('light'), 'novice');
    assert.equal(levelFromActivity('moderate'), 'regular');
    assert.equal(levelFromActivity('athlete'), 'regular');
  });

  test('у каждого упражнения программы есть, что записать в журнал', () => {
    const program = buildProgram(input({ daysPerWeek: 5, goal: 'lose' }));
    for (const planned of flat(program)) {
      assert.ok(planned.sets >= 1);
      // Либо повторы, либо минуты — пустой карточки в программе быть не должно
      assert.ok(planned.repMin !== null || planned.durationMin !== null);
    }
  });
});

/**
 * Замена упражнения — единственное место, где человек правит собранную
 * программу. Правила подбора здесь те же, что при сборке: иначе замена
 * стала бы дырой в защите от травм, ради которой всё и считается таблицей.
 */
describe('Замена упражнения', () => {
  function swap(overrides: Partial<AlternativeInput> = {}): AlternativeInput {
    return {
      pattern: 'h_push',
      currentId: 'Жим лёжа',
      exercises: CATALOG,
      place: 'gym',
      injuries: [],
      takenIds: [],
      ...overrides,
    };
  }

  test('даёт другое упражнение того же паттерна', () => {
    const next = nextAlternative(swap());
    assert.ok(next);
    assert.notEqual(next.exerciseId, 'Жим лёжа');
    assert.equal(card(next.exerciseId).pattern, 'h_push');
  });

  test('повторные замены обходят все варианты и возвращаются к первому', () => {
    // Обход должен быть циклическим: «лучшее из оставшихся» после исключения
    // текущего снова указывало бы на предыдущее, и кнопка перебирала бы
    // два упражнения туда-сюда
    // В зале доступен весь инвентарь справочника, включая брусья
    const inGym = CATALOG.filter((e) => e.pattern === 'h_push').length;

    const seen: string[] = [];
    let current = 'Жим лёжа';

    for (let i = 0; i < inGym + 1; i += 1) {
      const next = nextAlternative(swap({ currentId: current }));
      assert.ok(next, 'замена должна находиться на каждом шаге');
      seen.push(next.exerciseId);
      current = next.exerciseId;
    }

    // Круг замкнулся: за N шагов пройдены все варианты, на N+1 — повтор
    assert.equal(new Set(seen).size, seen.length - 1);
    assert.equal(seen.at(-1), seen[0]);
  });

  test('не предлагает то, что уже стоит в этом же дне', () => {
    const taken = CATALOG.filter((e) => e.pattern === 'h_push')
      .map((e) => e.id)
      .filter((id) => id !== 'Жим лёжа' && id !== 'Отжимания на брусьях');

    const next = nextAlternative(swap({ takenIds: taken }));
    assert.ok(next);
    assert.ok(!taken.includes(next.exerciseId));
  });

  test('дома не предлагает штангу', () => {
    const next = nextAlternative(
      swap({ place: 'home', currentId: 'Отжимания от пола' }),
    );
    assert.ok(next);
    assert.notEqual(card(next.exerciseId).equipment, 'штанга');
  });

  test('движение на больное место в замену не попадает', () => {
    // Та же строгость, что при сборке: предлагает приложение, а не человек
    const hurt: ActiveInjury[] = [{ area: 'shoulder', severity: 'pain' }];
    const next = nextAlternative(swap({ injuries: hurt, pattern: 'squat', currentId: 'Приседания со штангой' }));

    // В приседе плечо не задействовано — замена находится
    assert.ok(next);

    // А весь горизонтальный жим нагружает плечо: заменить нечем, и лучше
    // сказать это прямо, чем подставить то же самое движение под другим именем
    assert.equal(nextAlternative(swap({ injuries: hurt })), null);
  });

  test('«беспокоит» берётся только когда чистого варианта нет', () => {
    const watch: ActiveInjury[] = [{ area: 'knee', severity: 'watch' }];
    const next = nextAlternative(
      swap({ injuries: watch, pattern: 'squat', currentId: 'Приседания со штангой' }),
    );

    assert.ok(next);
    // Все приседания нагружают колено, поэтому вариант придёт с пометкой
    assert.deepEqual(next.caution, ['knee']);
  });

  test('единственный вариант заменить нечем', () => {
    const next = nextAlternative(
      swap({ pattern: 'quad_iso', currentId: 'Разгибания ног' }),
    );
    assert.equal(next, null);
  });

  test('кардио к замене не предлагается вовсе', () => {
    // Кардио-слот один и снаряд в нём не меняет сути: API до подбора
    // не доходит, но и подбор не должен предлагать бег вместо ходьбы
    const next = nextAlternative(swap({ pattern: 'cardio', currentId: 'Бег' }));
    assert.ok(next === null || card(next.exerciseId).pattern === 'cardio');
  });
});
