'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { api, ApiError, haptic, useTelegramApp } from '@/lib/telegram/client';
import type { Adjustment } from '@/lib/health/energy';
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
  adjustments: Adjustment[];
}

const ACTIVITIES: Activity[] = [
  'sedentary',
  'light',
  'moderate',
  'high',
  'athlete',
];

const STEPS = ['who', 'body', 'activity', 'frame', 'goal'] as const;

/** Дата ровно N лет назад — границы выбора в поле даты рождения */
function dateYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

/** Полных лет по дате рождения — показываем сразу под полем для самопроверки */
function calcAgeFrom(iso: string): number {
  const b = new Date(iso);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age;
}

export default function OnboardingPage() {
  const router = useRouter();
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
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

  useTelegramApp();

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
        setError(tc('saveFailed'));
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

      <h1 className="text-2xl font-semibold">{t(`steps.${STEPS[step]}`)}</h1>

      {error && <ErrorNote>{error}</ErrorNote>}

      {step === 0 && (
        <div className="fade-in flex flex-col gap-4">
          <Segmented
            value={sex}
            onChange={setSex}
            options={[
              { value: 'male', label: t('male') },
              { value: 'female', label: t('female') },
            ]}
          />
          <Field
            label={t('birthDate')}
            type="date"
            value={birthDate}
            error={fields.birthDate}
            // Границы обязательны: без них в выборе доступны будущие даты,
            // а WebKit ещё и рисует в пустом поле сегодняшнее число, из-за
            // чего поле выглядит уже заполненным
            min={dateYearsAgo(100)}
            max={dateYearsAgo(14)}
            onChange={(e) => setBirthDate(e.target.value)}
            hint={
              birthDate
                ? t('age', { age: calcAgeFrom(birthDate) })
                : t('pickDate')
            }
          />
          <Hint>{t('whoHint')}</Hint>
        </div>
      )}

      {step === 1 && (
        <div className="fade-in flex flex-col gap-4">
          <Field
            label={t('height')}
            unit={tc('cm')}
            value={heightCm}
            error={fields.heightCm}
            placeholder="175"
            onChange={(e) => setHeightCm(e.target.value)}
          />
          <Field
            label={t('weightToday')}
            unit={tc('kg')}
            value={weightKg}
            error={fields.weightKg}
            placeholder="70"
            onChange={(e) => setWeightKg(e.target.value)}
          />
          <Hint>{t('bodyHint')}</Hint>
        </div>
      )}

      {step === 2 && (
        <div className="fade-in flex flex-col gap-4">
          <RadioList
            value={activity}
            onChange={setActivity}
            options={ACTIVITIES.map((value) => ({
              value,
              label: t(`activity.${value}`),
              hint: t(`activity.${value}Hint`),
            }))}
          />
          <Hint>{t('activityHint')}</Hint>
        </div>
      )}

      {step === 3 && (
        <div className="fade-in flex flex-col gap-4">
          <Field
            label={t('wrist')}
            unit={tc('cm')}
            value={wristCm}
            placeholder="17"
            onChange={(e) => setWristCm(e.target.value)}
            hint={t('wristHint')}
          />
          <Field
            label={t('ankle')}
            unit={tc('cm')}
            value={ankleCm}
            placeholder="22"
            onChange={(e) => setAnkleCm(e.target.value)}
            hint={t('ankleHint')}
          />
          <Hint>{t('frameHint')}</Hint>
        </div>
      )}

      {step === 4 && (
        <div className="fade-in flex flex-col gap-4">
          <RadioList
            value={goalType}
            onChange={setGoalType}
            options={[
              { value: 'lose', label: t('goalLose') },
              { value: 'maintain', label: t('goalMaintain') },
              { value: 'gain', label: t('goalGain') },
            ]}
          />
          {goalType && goalType !== 'maintain' && (
            <>
              <Field
                label={t('rate')}
                unit={t('rateUnit')}
                value={weeklyRate}
                placeholder="0.5"
                onChange={(e) => setWeeklyRate(e.target.value)}
              />
              <Hint>
                {goalType === 'lose' ? t('loseHint') : t('gainHint')}
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
          {step === STEPS.length - 1 ? t('calculate') : tc('next')}
        </Button>
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            {tc('back')}
          </Button>
        )}
        {step === 3 && (
          <Button variant="ghost" onClick={() => setStep(4)}>
            {tc('skip')}
          </Button>
        )}
      </div>
    </Screen>
  );
}

/* ─────────────────────── Итог расчёта ──────────────────────────────── */

function PlanSummary({ plan, onDone }: { plan: Plan; onDone: () => void }) {
  const t = useTranslations('onboarding');
  const tc = useTranslations('common');
  const tm = useTranslations('macros');

  return (
    <Screen>
      <h1 className="text-2xl font-semibold">{t('planTitle')}</h1>

      <Card className="flex flex-col items-center gap-1 py-6">
        <span className="tabular text-5xl font-semibold">{plan.kcalTarget}</span>
        <span className="text-sm text-[var(--tg-theme-hint-color)]">
          {t('perDay')}
        </span>
      </Card>

      <Card>
        <div className="grid grid-cols-3 gap-3 text-center">
          {[
            [tm('protein'), plan.macros.proteinG],
            [tm('fat'), plan.macros.fatG],
            [tm('carbs'), plan.macros.carbsG],
          ].map(([label, value]) => (
            <div key={label as string} className="flex flex-col">
              <span className="tabular text-xl font-medium">
                {value} {tc('g')}
              </span>
              <span className="text-xs text-[var(--tg-theme-hint-color)]">{label}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-2 text-sm">
        <Row label={t('bmr')} value={`${plan.bmr} ${tc('kcal')}`} />
        <Row label={t('tdee')} value={`${plan.tdee} ${tc('kcal')}`} />
        <Row
          label={
            plan.dailyDelta < 0
              ? t('deficit')
              : plan.dailyDelta > 0
                ? t('surplus')
                : t('balance')
          }
          value={
            plan.dailyDelta === 0
              ? '—'
              : `${Math.abs(plan.dailyDelta)} ${tc('kcal')}`
          }
        />
        {plan.effectiveWeeklyRateKg > 0 && (
          <Row
            label={t('expectedRate')}
            value={`${plan.effectiveWeeklyRateKg} ${t('rateUnit')}`}
          />
        )}
      </Card>

      {/* Если цель пришлось урезать — говорим об этом прямо,
          а не подменяем запрошенную цифру молча */}
      {plan.adjustments.length > 0 && (
        <Card className="flex flex-col gap-2">
          {plan.adjustments.map((note) => (
            <p key={note.code} className="text-sm leading-snug">
              {note.code === 'raisedToFloor'
                ? t('adjust.raisedToFloor', { kcal: note.kcal })
                : t(`adjust.${note.code}`)}
            </p>
          ))}
        </Card>
      )}

      <Hint>{t('planHint')}</Hint>

      <div className="mt-auto pt-4">
        <Button onClick={onDone}>{t('start')}</Button>
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
