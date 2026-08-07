'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import {
  api,
  ApiError,
  haptic,
  useTelegramApp,
  useTelegramBack,
  useMainButton,
  useClosingConfirmation,
} from '@/lib/telegram/client';
import {
  Screen,
  Card,
  Hint,
  Button,
  Segmented,
  RadioList,
  Field,
  Spinner,
  ErrorNote,
} from '@/components/ui';
import type { Adjustment } from '@/lib/health/energy';

type Sex = 'male' | 'female';
type Activity = 'sedentary' | 'light' | 'moderate' | 'high' | 'athlete';
type GoalType = 'lose' | 'maintain' | 'gain';

interface Me {
  needsOnboarding: boolean;
  profile?: {
    sex: Sex;
    birthDate: string;
    age: number;
    heightCm: number;
    activityLevel: Activity;
    wristCm: number | null;
    ankleCm: number | null;
    bodyType: 'ectomorph' | 'mesomorph' | 'endomorph' | null;
    bodyTypeConsistent: boolean | null;
  };
  weight: { kg: number; loggedOn: string } | null;
  energy: { bmr: number; formula: string; tdee: number } | null;
  goal: {
    type: GoalType;
    kcalTarget: number;
    proteinTargetG: number;
    fatTargetG: number;
    carbTargetG: number;
    targetWeightKg: number | null;
    weeklyRateKg: number | null;
  } | null;
}

interface Plan {
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

/**
 * Профиль и цель.
 *
 * Онбординг проходится один раз, а жизнь меняется: человек дошёл до
 * желаемого веса и хочет его удерживать, начал ходить в зал, сменил темп.
 * Без этого экрана единственным способом пересчитать норму было бы завести
 * приложение заново.
 *
 * Форма отправляет тот же `/api/onboarding`: он перезаписывает профиль и
 * заводит новую активную цель, снимая старую. Отдельная ручка на правку
 * означала бы вторую копию расчёта нормы — и рано или поздно расхождение
 * между ними.
 */
export default function ProfilePage() {
  const router = useRouter();
  const t = useTranslations('profile');
  const to = useTranslations('onboarding');
  const tc = useTranslations('common');
  const tm = useTranslations('macros');

  useTelegramApp();
  useTelegramBack(useCallback(() => router.replace('/'), [router]));

  const [me, setMe] = useState<Me | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Plan | null>(null);

  const [sex, setSex] = useState<Sex>('male');
  const [birthDate, setBirthDate] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [activity, setActivity] = useState<Activity>('moderate');
  const [goalType, setGoalType] = useState<GoalType>('maintain');
  const [weeklyRate, setWeeklyRate] = useState('0.5');

  const load = useCallback(async () => {
    setError(null);
    try {
      const profile = await api<Me>('/api/me');
      if (profile.needsOnboarding || !profile.profile) {
        router.replace('/onboarding');
        return;
      }
      setMe(profile);

      // Форма открывается заполненной текущими данными: человек приходит
      // сюда поменять одно поле, а не вводить всё заново
      setSex(profile.profile.sex);
      setBirthDate(profile.profile.birthDate);
      setHeightCm(String(profile.profile.heightCm));
      setActivity(profile.profile.activityLevel);
      if (profile.weight) setWeightKg(String(profile.weight.kg));
      if (profile.goal) {
        setGoalType(profile.goal.type);
        if (profile.goal.weeklyRateKg) {
          setWeeklyRate(String(Math.abs(profile.goal.weeklyRateKg)));
        }
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('loadFailed'));
    }
  }, [router, tc]);

  useEffect(() => {
    load();
  }, [load]);

  const num = (value: string) => Number(value.replace(',', '.'));

  async function save() {
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
          // Каркас меряется один раз и здесь не трогается: обхваты запястья
          // и щиколотки от диеты не меняются
          wristCm: me?.profile?.wristCm ?? null,
          ankleCm: me?.profile?.ankleCm ?? null,
          goalType,
          weeklyRateKg: goalType === 'maintain' ? undefined : num(weeklyRate),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      haptic('success');
      setPlan(result.plan);
      setEditing(false);
      await load();
    } catch (e) {
      haptic('error');
      if (e instanceof ApiError) {
        setError(e.message);
        setFields(e.fields ?? {});
      } else {
        setError(tc('saveFailed'));
      }
    } finally {
      setSaving(false);
    }
  }

  // В режиме правки набранное не сохранено, пока не нажата кнопка
  useClosingConfirmation(editing);

  useMainButton({
    text: editing ? t('recalculate') : t('edit'),
    onClick: () => (editing ? save() : setEditing(true)),
    visible: me?.profile !== undefined,
    loading: saving,
  });

  if (error && !me) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={load}>{tc('retry')}</Button>
      </Screen>
    );
  }

  if (!me?.profile) {
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  }

  const profile = me.profile;

  return (
    <Screen>
      <h1 className="text-xl font-semibold">{t('title')}</h1>

      {plan && (
        <Card className="flex flex-col gap-2">
          <span className="text-sm text-[var(--tg-theme-hint-color)]">
            {t('recalculated')}
          </span>
          <span className="tabular text-3xl font-semibold">
            {plan.kcalTarget} {tc('kcal')}
          </span>
          <span className="tabular text-sm text-[var(--tg-theme-hint-color)]">
            {tm('short', {
              protein: plan.macros.proteinG,
              fat: plan.macros.fatG,
              carbs: plan.macros.carbsG,
            })}
          </span>
          {plan.adjustments.map((note) => (
            <span key={note.code} className="text-sm leading-snug">
              {note.code === 'raisedToFloor'
                ? to('adjust.raisedToFloor', { kcal: note.kcal })
                : to(`adjust.${note.code}`)}
            </span>
          ))}
        </Card>
      )}

      {!editing ? (
        <>
          <Card className="flex flex-col gap-2 text-sm">
            <Row label={to(goalKey(me.goal?.type))} value={goalValue()} />
            {me.goal && (
              <Row
                label={t('norm')}
                value={`${me.goal.kcalTarget} ${tc('kcal')}`}
              />
            )}
            {me.energy && (
              <>
                <Row
                  label={to('bmr')}
                  value={`${me.energy.bmr} ${tc('kcal')}`}
                />
                <Row
                  label={to('tdee')}
                  value={`${me.energy.tdee} ${tc('kcal')}`}
                />
              </>
            )}
          </Card>

          <Card className="flex flex-col gap-2 text-sm">
            <Row
              label={to(profile.sex === 'male' ? 'male' : 'female')}
              value={to('age', { age: profile.age })}
            />
            <Row
              label={to('height')}
              value={`${profile.heightCm} ${tc('cm')}`}
            />
            {me.weight && (
              <Row
                label={to('weightToday')}
                value={`${me.weight.kg} ${tc('kg')}`}
              />
            )}
            <Row
              label={to('steps.activity')}
              value={to(`activity.${profile.activityLevel}`)}
            />
            {profile.bodyType && (
              <Row
                label={t('bodyType')}
                value={t(`bodyTypes.${profile.bodyType}`)}
              />
            )}
          </Card>

          {/* Расхождение запястья и щиколотки — повод показать оговорку,
              а не выдать тип телосложения как факт */}
          {profile.bodyType && profile.bodyTypeConsistent === false && (
            <Hint>{t('bodyTypeMixed')}</Hint>
          )}


        </>
      ) : (
        <div className="fade-in flex flex-col gap-4">
          <Segmented
            value={sex}
            onChange={setSex}
            options={[
              { value: 'male', label: to('male') },
              { value: 'female', label: to('female') },
            ]}
          />
          <Field
            label={to('birthDate')}
            type="date"
            value={birthDate}
            error={fields.birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
          <Field
            label={to('height')}
            unit={tc('cm')}
            value={heightCm}
            error={fields.heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
          />
          <Field
            label={to('weightToday')}
            unit={tc('kg')}
            value={weightKg}
            error={fields.weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            hint={t('weightHint')}
          />

          <RadioList
            value={activity}
            onChange={setActivity}
            options={ACTIVITIES.map((value) => ({
              value,
              label: to(`activity.${value}`),
              hint: to(`activity.${value}Hint`),
            }))}
          />

          <RadioList
            value={goalType}
            onChange={setGoalType}
            options={[
              { value: 'lose', label: to('goalLose') },
              { value: 'maintain', label: to('goalMaintain') },
              { value: 'gain', label: to('goalGain') },
            ]}
          />

          {goalType !== 'maintain' && (
            <Field
              label={to('rate')}
              unit={to('rateUnit')}
              value={weeklyRate}
              onChange={(e) => setWeeklyRate(e.target.value)}
              hint={goalType === 'lose' ? to('loseHint') : to('gainHint')}
            />
          )}

          {error && <ErrorNote>{error}</ErrorNote>}

          <Button variant="ghost" onClick={() => setEditing(false)}>
            {tc('back')}
          </Button>
        </div>
      )}
    </Screen>
  );

  function goalKey(type: GoalType | undefined) {
    if (type === 'lose') return 'goalLose';
    if (type === 'gain') return 'goalGain';
    return 'goalMaintain';
  }

  /** Цель словами: целевой вес, если задан, иначе темп */
  function goalValue(): string {
    if (!me?.goal) return '—';
    if (me.goal.targetWeightKg) {
      return `${me.goal.targetWeightKg} ${tc('kg')}`;
    }
    if (me.goal.weeklyRateKg) {
      return `${Math.abs(me.goal.weeklyRateKg)} ${to('rateUnit')}`;
    }
    return t('holding');
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[var(--tg-theme-hint-color)]">{label}</span>
      <span className="tabular text-right font-medium">{value}</span>
    </div>
  );
}
