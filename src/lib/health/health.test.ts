import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  calcBodyFatPct,
  calcLeanBodyMass,
  calcBodyType,
  calcAge,
  calcBmi,
  movingAverageWeight,
} from './composition';

import {
  calcBmr,
  calcTdee,
  calcCalorieTarget,
  calcMacroTargets,
  buildDailyPlan,
} from './energy';

/** Сравнение с допуском — формулы возвращают дробные значения */
function near(actual: number, expected: number, tolerance = 0.5) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `ожидалось ${expected} ± ${tolerance}, получено ${actual}`,
  );
}

describe('Процент жира (US Navy)', () => {
  test('мужчина 180 см, шея 38, талия 85 → около 16%', () => {
    const pct = calcBodyFatPct({
      sex: 'male',
      heightCm: 180,
      neckCm: 38,
      waistCm: 85,
    });
    assert.ok(pct !== null);
    near(pct, 16.1, 0.3);
  });

  test('женщина 165 см, шея 32, талия 70, бёдра 95 → около 25%', () => {
    const pct = calcBodyFatPct({
      sex: 'female',
      heightCm: 165,
      neckCm: 32,
      waistCm: 70,
      hipCm: 95,
    });
    assert.ok(pct !== null);
    near(pct, 24.9, 0.3);
  });

  test('у женщины без обхвата бёдер расчёт невозможен', () => {
    const pct = calcBodyFatPct({
      sex: 'female',
      heightCm: 165,
      neckCm: 32,
      waistCm: 70,
    });
    assert.equal(pct, null);
  });

  test('талия не больше шеи — замер ошибочный, а не отрицательный процент', () => {
    const pct = calcBodyFatPct({
      sex: 'male',
      heightCm: 180,
      neckCm: 40,
      waistCm: 38,
    });
    assert.equal(pct, null);
  });

  test('результат вне физиологичного диапазона отбрасывается', () => {
    // Талия лишь на сантиметр больше шеи: формально считается,
    // но даёт нереалистично низкий процент.
    const pct = calcBodyFatPct({
      sex: 'male',
      heightCm: 180,
      neckCm: 40,
      waistCm: 41,
    });
    assert.equal(pct, null);
  });

  test('сухая масса при 20% жира и весе 80 кг = 64 кг', () => {
    assert.equal(calcLeanBodyMass(80, 20), 64);
  });
});

describe('Тип телосложения по каркасу', () => {
  test('мужские пороги запястья: 17 / 19 / 21 см', () => {
    assert.equal(calcBodyType('male', 17)?.bodyType, 'ectomorph');
    assert.equal(calcBodyType('male', 19)?.bodyType, 'mesomorph');
    assert.equal(calcBodyType('male', 21)?.bodyType, 'endomorph');
  });

  test('женские пороги запястья: 14 / 16 / 18 см', () => {
    assert.equal(calcBodyType('female', 14)?.bodyType, 'ectomorph');
    assert.equal(calcBodyType('female', 16)?.bodyType, 'mesomorph');
    assert.equal(calcBodyType('female', 18)?.bodyType, 'endomorph');
  });

  test('щиколотка подтверждает запястье', () => {
    const r = calcBodyType('male', 19, 22);
    assert.equal(r?.bodyType, 'mesomorph');
    assert.equal(r?.isConsistent, true);
  });

  test('щиколотка противоречит запястью — тип по запястью, но флаг снят', () => {
    const r = calcBodyType('male', 17, 26);
    assert.equal(r?.bodyType, 'ectomorph');
    assert.equal(r?.isConsistent, false);
  });

  test('без запястья тип не определяется', () => {
    assert.equal(calcBodyType('male', null, 22), null);
  });
});

describe('Базовый обмен', () => {
  test('Mifflin-St Jeor, мужчина 80 кг / 180 см / 30 лет = 1780', () => {
    const r = calcBmr({ sex: 'male', weightKg: 80, heightCm: 180, age: 30 });
    assert.equal(r.kcal, 1780);
    assert.equal(r.formula, 'mifflin-st-jeor');
  });

  test('Mifflin-St Jeor, женщина 60 кг / 165 см / 30 лет = 1320', () => {
    const r = calcBmr({ sex: 'female', weightKg: 60, heightCm: 165, age: 30 });
    assert.equal(r.kcal, 1320);
  });

  test('при известном проценте жира переключается на Katch-McArdle', () => {
    const r = calcBmr({
      sex: 'male',
      weightKg: 80,
      heightCm: 180,
      age: 30,
      bodyFatPct: 20,
    });
    assert.equal(r.formula, 'katch-mcardle');
    assert.equal(r.kcal, 1752); // 370 + 21.6 × 64
  });

  test('при равном весе больший процент жира даёт меньший обмен', () => {
    const lean = calcBmr({
      sex: 'male', weightKg: 80, heightCm: 180, age: 30, bodyFatPct: 12,
    });
    const fat = calcBmr({
      sex: 'male', weightKg: 80, heightCm: 180, age: 30, bodyFatPct: 30,
    });
    assert.ok(lean.kcal > fat.kcal);
  });
});

describe('Суточный расход', () => {
  test('умеренная активность — коэффициент 1.55', () => {
    assert.equal(calcTdee(1780, 'moderate'), 2759);
  });
});

describe('Норма калорий', () => {
  const base = { tdee: 2759, bmr: 1780, sex: 'male' as const, weightKg: 80 };

  test('поддержание веса — норма равна расходу', () => {
    const r = calcCalorieTarget({ ...base, goalType: 'maintain' });
    assert.equal(r.kcal, 2759);
    assert.equal(r.dailyDelta, 0);
    assert.equal(r.adjustments.length, 0);
  });

  test('0.5 кг/неделю укладывается в лимит без правок', () => {
    const r = calcCalorieTarget({
      ...base, goalType: 'lose', weeklyRateKg: 0.5,
    });
    assert.equal(r.kcal, 2209); // 2759 − 550
    assert.equal(r.adjustments.length, 0);
    near(r.effectiveWeeklyRateKg, 0.5, 0.01);
  });

  test('запрос 1.5 кг/неделю урезается потолком в 25%', () => {
    const r = calcCalorieTarget({
      ...base, goalType: 'lose', weeklyRateKg: 1.5,
    });
    assert.ok(r.adjustments.length > 0);
    assert.ok(r.effectiveWeeklyRateKg < 1.5);
    // Дефицит ровно 25% от расхода
    near(r.kcal, 2759 * 0.75, 1);
  });

  test('норма не опускается ниже базового обмена и абсолютного минимума', () => {
    // Миниатюрная женщина с сидячим образом жизни: агрессивная цель
    // упирается сразу в три ограничителя.
    const r = calcCalorieTarget({
      tdee: 1420,
      bmr: 1183,
      sex: 'female',
      weightKg: 50,
      goalType: 'lose',
      weeklyRateKg: 1,
    });
    assert.ok(r.kcal >= 1200, `норма ${r.kcal} ниже минимума`);
    assert.ok(r.adjustments.length >= 2);
  });

  test('профицит ограничен 20% от расхода', () => {
    const r = calcCalorieTarget({
      ...base, goalType: 'gain', weeklyRateKg: 1,
    });
    assert.ok(r.kcal <= 2759 * 1.2 + 1);
    assert.ok(r.dailyDelta > 0);
  });
});

describe('Раскладка БЖУ', () => {
  test('сумма БЖУ сходится с нормой калорий', () => {
    const m = calcMacroTargets(2209, 80, 'lose');
    const total = m.proteinG * 4 + m.fatG * 9 + m.carbsG * 4;
    near(total, 2209, 5);
  });

  test('на дефиците белок выше, чем на поддержании', () => {
    const lose = calcMacroTargets(2200, 80, 'lose');
    const maintain = calcMacroTargets(2200, 80, 'maintain');
    assert.ok(lose.proteinG > maintain.proteinG);
  });

  test('белок считается от сухой массы, если известен процент жира', () => {
    const withFat = calcMacroTargets(2200, 80, 'lose', 30);
    const without = calcMacroTargets(2200, 80, 'lose');
    // 2.2 × 56 кг сухой массы против 2.2 × 80 кг общего веса
    assert.ok(withFat.proteinG < without.proteinG);
    assert.equal(withFat.proteinG, Math.round(56 * 2.2));
  });

  test('жир не опускается ниже 0.8 г/кг веса', () => {
    // Низкая норма при большом весе: 25% от калорий дали бы меньше порога
    const m = calcMacroTargets(1600, 100, 'lose');
    assert.ok(m.fatG >= Math.round(100 * 0.8));
  });

  test('углеводы не уходят в минус при нереалистичной цели', () => {
    const m = calcMacroTargets(1200, 120, 'lose');
    assert.ok(m.carbsG >= 0);
  });
});

describe('Полный дневной план', () => {
  test('связывает обмен, расход, норму и БЖУ', () => {
    const plan = buildDailyPlan({
      sex: 'male',
      age: 30,
      heightCm: 180,
      weightKg: 80,
      activity: 'moderate',
      goalType: 'lose',
      weeklyRateKg: 0.5,
    });

    assert.equal(plan.bmr, 1780);
    assert.equal(plan.tdee, 2759);
    assert.equal(plan.kcalTarget, 2209);
    assert.ok(plan.macros.proteinG > 0);
    assert.ok(plan.kcalTarget < plan.tdee);
    assert.ok(plan.kcalTarget > plan.bmr);
  });
});

describe('Вспомогательные величины', () => {
  test('возраст считается с учётом того, был ли день рождения', () => {
    assert.equal(calcAge('1990-06-15', new Date('2026-06-14')), 35);
    assert.equal(calcAge('1990-06-15', new Date('2026-06-15')), 36);
  });

  test('ИМТ 80 кг при 180 см ≈ 24.7', () => {
    near(calcBmi(80, 180), 24.7, 0.1);
  });

  test('скользящее среднее гасит суточные колебания веса', () => {
    const logs = [
      { loggedOn: '2026-01-01', weightKg: 80.0 },
      { loggedOn: '2026-01-02', weightKg: 81.5 }, // соль накануне
      { loggedOn: '2026-01-03', weightKg: 79.8 },
      { loggedOn: '2026-01-04', weightKg: 80.1 },
    ];
    const avg = movingAverageWeight(logs, 7);

    assert.equal(avg.length, 4);
    assert.equal(avg[0].average, 80.0); // первый день — сам по себе
    // Скачок 81.5 в среднем сглажен
    assert.ok(avg[1].average < 81.5 && avg[1].average > 80);
    near(avg[3].average, 80.35, 0.01);
  });

  test('записи сортируются по дате независимо от порядка на входе', () => {
    const avg = movingAverageWeight([
      { loggedOn: '2026-01-03', weightKg: 79 },
      { loggedOn: '2026-01-01', weightKg: 81 },
      { loggedOn: '2026-01-02', weightKg: 80 },
    ]);
    assert.deepEqual(
      avg.map((a) => a.date),
      ['2026-01-01', '2026-01-02', '2026-01-03'],
    );
  });
});
