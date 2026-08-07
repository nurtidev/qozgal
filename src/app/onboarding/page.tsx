'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { api, ApiError, getWebApp, applyTheme, haptic } from '@/lib/telegram/client';
import {
  Screen,
  Card,
  Hint,
  Button,
  Segmented,
  RadioList,
  Field,
  ErrorNote,
} from '@/components/ui';

type Sex = 'male' | 'female';
type Activity = 'sedentary' | 'light' | 'moderate' | 'high' | 'athlete';
type GoalType = 'lose' | 'maintain' | 'gain';

interface Plan {
  bmr: number;
  bmrFormula: string;
  tdee: number;
  kcalTarget: number;
  dailyDelta: number;
  effectiveWeeklyRateKg: number;
  macros: { proteinG: number; fatG: number; carbsG: number };
  adjustments: string[];
}

const ACTIVITY_OPTIONS: { value: Activity; label: string; hint: string }[] = [
  { value: 'sedentary', label: 'Сидячий', hint: 'Работа за столом, без спорта' },
  { value: 'light', label: 'Лёгкая', hint: '1–3 тренировки в неделю' },
  { value: 'moderate', label: 'Средняя', hint: '3–5 тренировок в неделю' },
  { value: 'high', label: 'Высокая', hint: '6–7 тренировок в неделю' },
  { value: 'athlete', label: 'Очень высокая', hint: 'Две тренировки в день или физический труд' },
];

const STEPS = ['Кто вы', 'Параметры', 'Образ жизни', 'Каркас', 'Цель'] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Plan | null>(null);

  const [sex, setSex] = useState<Sex | null>(null);
  const [birthDate, setBirthDate] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [activity, setActivity] = useState<Activity>('moderate');
  const [wristCm, setWristCm] = useState('');
  const [ankleCm, setAnkleCm] = useState('');
  const [goalType, setGoalType] = useState<GoalType | null>(null);
  const [weeklyRate, setWeeklyRate] = useState('0.5');

  useEffect(() => {
    const app = getWebApp();
    if (app) {
      app.ready();
      app.expand();
      applyTheme(app);
    }
  }, []);

  const num = (v: string) => Number(v.replace(',', '.'));

  const canContinue = [
    Boolean(sex && birthDate),
    Boolean(heightCm && weightKg),
    true,
    true,
    Boolean(goalType),
  ][step];

  async function submit() {
    setSaving(true);
    setError(null);
    setFields({});

    try {
      const result = await api<{ plan: Plan }>('/api/onboarding', {
        method: 'POST',
        body: JSON.stringify({
          sex,
          birthDate,
          heightCm: num(heightCm),
          weightKg: num(weightKg),
          activityLevel: activity,
          wristCm: wristCm ? num(wristCm) : null,
          ankleCm: ankleCm ? num(ankleCm) : null,
          goalType,
          weeklyRateKg: goalType === 'maintain' ? undefined : num(weeklyRate),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      haptic('success');
      setPlan(result.plan);
    } catch (e) {
      haptic('error');
      if (e instanceof ApiError) {
        setError(e.message);
        setFields(e.fields ?? {});
        // Возвращаем на шаг с ошибочным полем, иначе человек видит
        // сообщение об ошибке и не понимает, что именно править
        if (e.fields?.birthDate) setStep(0);
        else if (e.fields?.heightCm || e.fields?.weightKg) setStep(1);
      } else {
        setError('Не удалось сохранить. Попробуйте ещё раз.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (plan) return <PlanSummary plan={plan} onDone={() => router.replace('/')} />;

  return (
    <Screen>
      <div className="flex gap-1.5">
        {STEPS.map((_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i <= step
                ? 'bg-[var(--tg-theme-button-color)]'
                : 'bg-[var(--tg-theme-secondary-bg-color)]'
            }`}
          />
        ))}
      </div>

      <h1 className="text-2xl font-semibold">{STEPS[step]}</h1>

      {error && <ErrorNote>{error}</ErrorNote>}

      {step === 0 && (
        <div className="fade-in flex flex-col gap-4">
          <Segmented
            value={sex}
            onChange={setSex}
            options={[
              { value: 'male', label: 'Мужчина' },
              { value: 'female', label: 'Женщина' },
            ]}
          />
          <Field
            label="Дата рождения"
            type="date"
            value={birthDate}
            error={fields.birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
          <Hint>
            Пол и возраст входят в формулу основного обмена — без них норма
            калорий получится неверной.
          </Hint>
        </div>
      )}

      {step === 1 && (
        <div className="fade-in flex flex-col gap-4">
          <Field
            label="Рост"
            unit="см"
            value={heightCm}
            error={fields.heightCm}
            placeholder="175"
            onChange={(e) => setHeightCm(e.target.value)}
          />
          <Field
            label="Вес сегодня"
            unit="кг"
            value={weightKg}
            error={fields.weightKg}
            placeholder="70"
            onChange={(e) => setWeightKg(e.target.value)}
          />
          <Hint>
            Взвешивайтесь утром натощак. Дальше приложение будет показывать
            среднее за неделю: дневные колебания воды доходят до полутора
            килограммов и полностью скрывают настоящий тренд.
          </Hint>
        </div>
      )}

      {step === 2 && (
        <div className="fade-in flex flex-col gap-4">
          <RadioList value={activity} onChange={setActivity} options={ACTIVITY_OPTIONS} />
          <Hint>
            Учитывайте всю дневную активность, а не только зал. Если сомневаетесь
            между двумя вариантами, берите тот, что ниже: завышенная активность
            даёт завышенную норму и незаметно съедает дефицит.
          </Hint>
        </div>
      )}

      {step === 3 && (
        <div className="fade-in flex flex-col gap-4">
          <Field
            label="Обхват запястья"
            unit="см"
            value={wristCm}
            placeholder="17"
            onChange={(e) => setWristCm(e.target.value)}
            hint="В самом узком месте, ниже косточки"
          />
          <Field
            label="Обхват щиколотки"
            unit="см"
            value={ankleCm}
            placeholder="22"
            onChange={(e) => setAnkleCm(e.target.value)}
            hint="Тоже в самом узком месте, над косточкой"
          />
          <Hint>
            Эти два замера делаются один раз: там почти нет мышц и жира, поэтому
            они показывают толщину костяка и не меняются ни от диеты, ни от
            тренировок. На норму калорий не влияют — нужны только для оценки
            телосложения. Можно пропустить.
          </Hint>
        </div>
      )}

      {step === 4 && (
        <div className="fade-in flex flex-col gap-4">
          <RadioList
            value={goalType}
            onChange={setGoalType}
            options={[
              { value: 'lose', label: 'Снизить вес' },
              { value: 'maintain', label: 'Удержать вес' },
              { value: 'gain', label: 'Набрать массу' },
            ]}
          />
          {goalType && goalType !== 'maintain' && (
            <>
              <Field
                label="Желаемый темп"
                unit="кг/нед"
                value={weeklyRate}
                placeholder="0.5"
                onChange={(e) => setWeeklyRate(e.target.value)}
              />
              <Hint>
                {goalType === 'lose'
                  ? 'Безопасный темп — до 1% массы тела в неделю. Если запросить больше, приложение урежет цифру и объяснит почему.'
                  : 'Набирать быстрее 0.5 кг в неделю смысла мало: сверх этого прирост идёт преимущественно в жир.'}
              </Hint>
            </>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <Button
          onClick={() => (step === STEPS.length - 1 ? submit() : setStep(step + 1))}
          disabled={!canContinue}
          loading={saving}
        >
          {step === STEPS.length - 1 ? 'Рассчитать норму' : 'Дальше'}
        </Button>
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            Назад
          </Button>
        )}
        {step === 3 && (
          <Button variant="ghost" onClick={() => setStep(4)}>
            Пропустить
          </Button>
        )}
      </div>
    </Screen>
  );
}

/* ─────────────────────── Итог расчёта ──────────────────────────────── */

function PlanSummary({ plan, onDone }: { plan: Plan; onDone: () => void }) {
  return (
    <Screen>
      <h1 className="text-2xl font-semibold">Ваша норма</h1>

      <Card className="flex flex-col items-center gap-1 py-6">
        <span className="tabular text-5xl font-semibold">{plan.kcalTarget}</span>
        <span className="text-sm text-[var(--tg-theme-hint-color)]">ккал в день</span>
      </Card>

      <Card>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            ['Белки', plan.macros.proteinG],
            ['Жиры', plan.macros.fatG],
            ['Углеводы', plan.macros.carbsG],
          ].map(([label, value]) => (
            <div key={label as string} className="flex flex-col">
              <span className="tabular text-xl font-medium">{value} г</span>
              <span className="text-xs text-[var(--tg-theme-hint-color)]">{label}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-2 text-sm">
        <Row label="Основной обмен" value={`${plan.bmr} ккал`} />
        <Row label="Суточный расход" value={`${plan.tdee} ккал`} />
        <Row
          label={plan.dailyDelta < 0 ? 'Дефицит' : plan.dailyDelta > 0 ? 'Профицит' : 'Баланс'}
          value={`${plan.dailyDelta === 0 ? '—' : `${Math.abs(plan.dailyDelta)} ккал`}`}
        />
        {plan.effectiveWeeklyRateKg > 0 && (
          <Row label="Ожидаемый темп" value={`${plan.effectiveWeeklyRateKg} кг/нед`} />
        )}
      </Card>

      {/* Если цель пришлось урезать — говорим об этом прямо,
          а не подменяем запрошенную цифру молча */}
      {plan.adjustments.length > 0 && (
        <Card className="flex flex-col gap-2">
          {plan.adjustments.map((note) => (
            <p key={note} className="text-sm leading-snug">
              {note}
            </p>
          ))}
        </Card>
      )}

      <Hint>
        Расчёт по формуле Mifflin-St Jeor. После первых замеров обхватов
        приложение перейдёт на формулу от сухой массы — она точнее, потому что
        жировая ткань почти не тратит энергию.
      </Hint>

      <div className="mt-auto pt-4">
        <Button onClick={onDone}>Начать вести дневник</Button>
      </div>
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[var(--tg-theme-hint-color)]">{label}</span>
      <span className="tabular font-medium">{value}</span>
    </div>
  );
}
