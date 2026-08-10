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
  Divider,
  Row,
  Section,
  Hint,
  Button,
  Field,
  ScreenSkeleton,
  ErrorNote,
} from '@/components/ui';
import { calcLeanBodyMass } from '@/lib/health/composition';
import { useDates } from '@/i18n/dates';

interface Measurement {
  measuredOn: string;
  neckCm: number;
  waistCm: number;
  hipCm: number | null;
  chestCm: number | null;
  bicepsCm: number | null;
  thighCm: number | null;
  calfCm: number | null;
  bodyFatPct: number | null;
}

interface Me {
  needsOnboarding: boolean;
  profile?: { sex: 'male' | 'female'; heightCm: number };
  weight: { kg: number; loggedOn: string } | null;
}

/** Границы те же, что проверяет API: расходиться им нельзя */
const LIMITS = {
  neckCm: [20, 80],
  waistCm: [40, 200],
  hipCm: [50, 200],
  chestCm: [50, 200],
  bicepsCm: [15, 80],
  thighCm: [30, 120],
  calfCm: [20, 80],
} as const;

type FieldName = keyof typeof LIMITS;

/** Необязательные обхваты: в расчёт не входят, нужны только для динамики */
const EXTRA = [
  { name: 'chestCm', label: 'chest', hint: 'chestHint' },
  { name: 'bicepsCm', label: 'biceps', hint: 'bicepsHint' },
  { name: 'thighCm', label: 'thigh', hint: 'thighHint' },
  { name: 'calfCm', label: 'calf', hint: 'calfHint' },
] as const;

export default function MeasurementsPage() {
  const router = useRouter();
  const t = useTranslations('measurements');
  const tc = useTranslations('common');
  const dates = useDates();

  useTelegramApp();
  useTelegramBack(useCallback(() => router.replace('/'), [router]));

  const [me, setMe] = useState<Me | null>(null);
  const [history, setHistory] = useState<Measurement[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showExtra, setShowExtra] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const [profile, list] = await Promise.all([
        api<Me>('/api/me'),
        api<{ measurements: Measurement[] }>('/api/measurements'),
      ]);
      if (profile.needsOnboarding) {
        router.replace('/onboarding');
        return;
      }
      setMe(profile);
      setHistory(list.measurements);

      // Поля заполняем прошлым замером: обхваты меняются на сантиметры,
      // и набирать семь чисел заново — верный способ забросить замеры
      const last = list.measurements[0];
      if (last) {
        setValues((prev) =>
          Object.keys(prev).length
            ? prev
            : Object.fromEntries(
                (Object.keys(LIMITS) as FieldName[])
                  .filter((k) => last[k] != null)
                  .map((k) => [k, String(last[k])]),
              ),
        );
        if (last.chestCm ?? last.bicepsCm ?? last.thighCm ?? last.calfCm) {
          setShowExtra(true);
        }
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('loadFailed'));
    }
  }, [router, t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);

  function num(name: FieldName): number | null {
    const text = (values[name] ?? '').replace(',', '.').trim();
    if (!text) return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : NaN;
  }

  async function save() {
    if (!me?.profile) return;

    const body: Record<string, number | null> = {};
    const bad: Record<string, string> = {};

    for (const name of Object.keys(LIMITS) as FieldName[]) {
      const value = num(name);
      if (value === null) {
        body[name] = null;
        continue;
      }
      const [min, max] = LIMITS[name];
      if (Number.isNaN(value) || value < min || value > max) {
        bad[name] = t('range', { min, max });
        continue;
      }
      body[name] = value;
    }

    // Шея и талия входят в формулу процента жира, у женщин ещё и бёдра —
    // без них считать нечего. Проверка «не задано» не должна затирать
    // сообщение о диапазоне: 300 см на талии — это опечатка, а не пропуск
    if (body.neckCm == null && !bad.neckCm) bad.neckCm = t('needNeck');
    if (body.waistCm == null && !bad.waistCm) bad.waistCm = t('needWaist');
    if (me.profile.sex === 'female' && body.hipCm == null && !bad.hipCm) {
      bad.hipCm = t('needHip');
    }

    if (Object.keys(bad).length) {
      setFields(bad);
      haptic('error');
      return;
    }

    setSaving(true);
    setError(null);
    setFields({});

    try {
      const result = await api<{ bodyFatPct: number | null; bodyFatNote: string | null }>(
        '/api/measurements',
        { method: 'POST', body: JSON.stringify(body) },
      );
      haptic(result.bodyFatPct === null ? 'error' : 'success');
      setSaved(true);
      setNote(result.bodyFatNote);
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

  // Набранные обхваты не сохранены, пока не нажата кнопка
  useClosingConfirmation(Object.values(values).some(Boolean) && !saved);

  useMainButton({
    text: saved ? t('saved') : t('save'),
    onClick: save,
    visible: history !== null,
    loading: saving,
  });

  if (error && !history) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={load}>{tc('retry')}</Button>
      </Screen>
    );
  }

  if (!me || !history) {
    return (
      <Screen>
        <ScreenSkeleton />
      </Screen>
    );
  }

  const [last, previous] = history;
  const female = me.profile?.sex === 'female';
  const weightKg = me.weight?.kg ?? null;

  const lean =
    last?.bodyFatPct != null && weightKg !== null
      ? calcLeanBodyMass(weightKg, last.bodyFatPct)
      : null;

  const fatChange =
    last?.bodyFatPct != null && previous?.bodyFatPct != null
      ? Math.round((last.bodyFatPct - previous.bodyFatPct) * 10) / 10
      : null;
  const waistChange =
    last && previous ? Math.round((last.waistCm - previous.waistCm) * 10) / 10 : null;

  return (
    <Screen>
      <header className="flex items-baseline justify-between">
        <h1 className="t-title">{t('title')}</h1>
        {last && (
          <span className="t-caption">
            {dates.dayMonthShort(last.measuredOn)}
          </span>
        )}
      </header>

      {last && (
        <Card className="flex flex-col gap-1">
          {last.bodyFatPct != null ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="tabular text-4xl font-semibold">
                  {last.bodyFatPct}%
                </span>
                <span className="t-caption">
                  {t('fat')}
                </span>
              </div>
              {lean !== null && weightKg !== null && (
                <span className="t-caption tabular">
                  {t('lean', { lean, weight: weightKg })}
                </span>
              )}
            </>
          ) : (
            <Hint>{t('noFat')}</Hint>
          )}

          {previous && (fatChange !== null || waistChange !== null) && (
            <span className="tabular mt-1 text-sm">
              {[
                fatChange !== null && t('changeFat', { delta: signed(fatChange) }),
                waistChange !== null &&
                  t('changeWaist', { delta: signed(waistChange) }),
              ]
                .filter(Boolean)
                .join(' · ')}{' '}
              <span className="text-[var(--tg-theme-hint-color)]">
                {t('since', { date: dates.dayMonthShort(previous.measuredOn) })}
              </span>
            </span>
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <Field
          label={t('neck')}
          unit={tc('cm')}
          value={values.neckCm ?? ''}
          error={fields.neckCm}
          placeholder="38"
          onChange={(e) => setValues({ ...values, neckCm: e.target.value })}
          hint={t('neckHint')}
        />
        <Field
          label={t('waist')}
          unit={tc('cm')}
          value={values.waistCm ?? ''}
          error={fields.waistCm}
          placeholder="85"
          onChange={(e) => setValues({ ...values, waistCm: e.target.value })}
          hint={t('waistHint')}
        />
        <Field
          label={female ? t('hip') : t('hipOptional')}
          unit={tc('cm')}
          value={values.hipCm ?? ''}
          error={fields.hipCm}
          placeholder="95"
          onChange={(e) => setValues({ ...values, hipCm: e.target.value })}
          hint={t('hipHint')}
        />

        {showExtra ? (
          EXTRA.map((f) => (
            <Field
              key={f.name}
              label={t(f.label)}
              unit={tc('cm')}
              value={values[f.name] ?? ''}
              error={fields[f.name]}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              // Подсказку по технике держим, пока поле пустое: она нужна
              // на первом замере, а на повторных четыре строки инструкций
              // превращают форму в стену текста
              hint={values[f.name] ? undefined : t(f.hint)}
            />
          ))
        ) : (
          <Button variant="ghost" onClick={() => setShowExtra(true)}>
            {t('addExtra')}
          </Button>
        )}

      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}
      {note && <ErrorNote>{note}</ErrorNote>}

      <Hint>{t('hint')}</Hint>

      {history.length > 1 && (
        // История — ведомость с разделителями: замеры сравнивают между
        // собой, а десяток отдельных карточек мешает вести взгляд по
        // столбцу процента жира
        <Section label={t('history')}>
          <Card className="flex flex-col">
            {history.slice(0, 10).map((m, index) => (
              <div key={m.measuredOn}>
                {index > 0 && <Divider />}
                <Row
                  title={dates.dayMonthShort(m.measuredOn)}
                  trailing={
                    <span className="t-caption tabular">
                      {m.bodyFatPct != null
                        ? `${t('historyFat', { pct: m.bodyFatPct })} · `
                        : ''}
                      {t('historyWaist', { waist: m.waistCm })}
                    </span>
                  }
                />
              </div>
            ))}
          </Card>
        </Section>
      )}
    </Screen>
  );
}

/** Знак у изменения ставим всегда: «0.4» и «−0.4» иначе не различить */
function signed(value: number): string {
  if (value === 0) return '±0';
  return `${value > 0 ? '+' : '−'}${Math.abs(value)}`;
}
