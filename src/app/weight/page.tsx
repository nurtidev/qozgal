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
  Field,
  ScreenSkeleton,
  ErrorNote,
} from '@/components/ui';
import { useDates } from '@/i18n/dates';

interface Point {
  date: string;
  raw: number;
  average: number;
}

interface History {
  series: Point[];
  /** Изменение среднего за период, кг. null — точек меньше двух */
  change: number | null;
  latest: { date: string; raw: number; average: number } | null;
}

interface Me {
  today: string;
  needsOnboarding: boolean;
  weight: { kg: number; loggedOn: string } | null;
  goal: {
    type: 'lose' | 'maintain' | 'gain';
    targetWeightKg: number | null;
    weeklyRateKg: number | null;
  } | null;
}

/** Периоды строками: переключатель работает со строковыми значениями */
type Days = '30' | '90' | '365';

const PERIODS: { value: Days; key: 'periodMonth' | 'periodQuarter' | 'periodYear' }[] = [
  { value: '30', key: 'periodMonth' },
  { value: '90', key: 'periodQuarter' },
  { value: '365', key: 'periodYear' },
];

export default function WeightPage() {
  const router = useRouter();
  const t = useTranslations('weight');
  const tc = useTranslations('common');
  const dates = useDates();

  useTelegramApp();
  useTelegramBack(useCallback(() => router.replace('/'), [router]));

  const [days, setDays] = useState<Days>('90');
  const [me, setMe] = useState<Me | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [value, setValue] = useState('');
  const [date, setDate] = useState('');
  const [showDate, setShowDate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setError(null);
    try {
      const [profile, series] = await Promise.all([
        api<Me>('/api/me'),
        api<History>(`/api/weight?days=${days}`),
      ]);
      if (profile.needsOnboarding) {
        router.replace('/onboarding');
        return;
      }
      setMe(profile);
      setHistory(series);
      setDate((prev) => prev || profile.today);
      // Поле заполняем последним взвешиванием: чаще всего человек правит
      // цифру на пару сотен граммов, а не набирает её с нуля
      setValue((prev) => prev || (profile.weight ? String(profile.weight.kg) : ''));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('loadFailed'));
    }
  }, [days, router, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Подтверждение «записано» живёт недолго: это отклик на действие,
  // а не состояние экрана
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);

  async function save() {
    const kg = Number(value.replace(',', '.').trim());
    if (!Number.isFinite(kg) || kg < 30 || kg > 400) {
      setFieldError(t('range'));
      haptic('error');
      return;
    }

    setSaving(true);
    setError(null);
    setFieldError(undefined);

    try {
      await api('/api/weight', {
        method: 'POST',
        body: JSON.stringify({ weightKg: kg, loggedOn: date }),
      });
      haptic('success');
      setSaved(true);
      await load();
    } catch (e) {
      haptic('error');
      if (e instanceof ApiError) {
        setError(e.message);
        setFieldError(e.fields?.weightKg);
      } else {
        setError(t('recordFailed'));
      }
    } finally {
      setSaving(false);
    }
  }

  // Набранный вес ещё не записан — свайп вниз потерял бы его
  useClosingConfirmation(Boolean(value) && value !== String(me?.weight?.kg ?? ''));

  useMainButton({
    text: saved ? t('recorded') : t('record'),
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

  const { series, change, latest } = history;
  const target = me.goal?.targetWeightKg ?? null;

  return (
    <Screen>
      <header className="flex items-baseline justify-between">
        <h1 className="t-title">{t('title')}</h1>
        {latest && (
          <span className="t-caption">
            {dates.dayMonthShort(latest.date)}
          </span>
        )}
      </header>

      {latest ? (
        <Card className="flex flex-col gap-1">
          {/* Главная цифра — среднее за неделю, а не последнее взвешивание:
              вода даёт разброс до полутора килограммов и полностью скрывает
              тренд, ради которого человек и встаёт на весы */}
          <div className="flex items-baseline gap-2">
            <span className="tabular text-4xl font-semibold">
              {latest.average.toFixed(1)}
            </span>
            <span className="t-caption">
              {t('average')}
            </span>
          </div>
          <span className="t-caption tabular">
            {t('last', { kg: latest.raw })}
            {target !== null ? ` · ${t('target', { kg: target })}` : ''}
          </span>
          {change !== null && (
            // Отсчёт от первой точки ряда, а не от границы выбранного
            // периода: если взвешиваний за три месяца всего две недели,
            // «за 3 месяца» приписало бы прогрессу лишний срок
            <span className="tabular mt-1 text-sm">
              {change === 0
                ? t('unchanged', { date: dates.dayMonthShort(series[0].date) })
                : t('change', {
                    delta: `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(1)}`,
                    date: dates.dayMonthShort(series[0].date),
                  })}
            </span>
          )}
        </Card>
      ) : (
        <Card>
          <Hint>{t('firstHint')}</Hint>
        </Card>
      )}

      <Segmented
        value={days}
        options={PERIODS.map((p) => ({ value: p.value, label: t(p.key) }))}
        onChange={setDays}
      />

      <Card className="flex flex-col gap-2">
        {series.length >= 2 ? (
          <>
            <WeightChart points={series} targetKg={target} />
            <div className="flex justify-between text-xs text-[var(--tg-theme-hint-color)]">
              <span>{dates.dayMonthShort(series[0].date)}</span>
              <span>
                {dates.dayMonthShort(series[series.length - 1].date)}
              </span>
            </div>
          </>
        ) : (
          <Hint>{t('needSecond')}</Hint>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <Field
          label={
            showDate
              ? t('forDate', { date: dates.dayMonthShort(date) })
              : t('today')
          }
          unit={tc('kg')}
          value={value}
          error={fieldError}
          placeholder="80"
          onChange={(e) => setValue(e.target.value)}
        />

        {showDate && (
          <Field
            label={t('date')}
            type="date"
            value={date}
            max={me.today}
            onChange={(e) => setDate(e.target.value)}
            hint={t('dateHint')}
          />
        )}

        {!showDate && (
          <Button variant="ghost" onClick={() => setShowDate(true)}>
            {t('otherDay')}
          </Button>
        )}
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Hint>{t('hint')}</Hint>
    </Screen>
  );
}

/* ──────────────────────────── График ───────────────────────────────── */

/**
 * Линия скользящего среднего и точки сырых взвешиваний.
 *
 * Своя разметка вместо библиотеки графиков: нужна одна ломаная, а любая
 * библиотека весит десятки килобайт, которые Mini App грузит по мобильной
 * сети. Координата X пропорциональна дате, а не порядковому номеру: при
 * пропуске в неделю равномерная сетка врала бы про скорость изменения.
 */
function WeightChart({
  points,
  targetKg,
}: {
  points: Point[];
  targetKg: number | null;
}) {
  const t = useTranslations('weight');
  const W = 320;
  const H = 120;
  const PAD = 10;

  const times = points.map((p) => Date.parse(p.date));
  const minT = Math.min(...times);
  const maxT = Math.max(...times);

  // Подписи осей — по диапазону взвешиваний, а масштаб — с учётом цели:
  // иначе подпись «76.0» дублировала бы пунктир цели и врала бы про то,
  // что такой вес уже был
  const dataValues = points.flatMap((p) => [p.raw, p.average]);
  const dataMin = Math.min(...dataValues);
  const dataMax = Math.max(...dataValues);

  const values = targetKg !== null ? [...dataValues, targetKg] : dataValues;
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  // Все значения совпали — деление на ноль; рисуем линию по центру
  const span = maxV - minV || 1;

  const x = (t: number) => PAD + ((t - minT) / (maxT - minT || 1)) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - minV) / span) * (H - 2 * PAD);

  const line = points.map((p) => `${x(Date.parse(p.date))},${y(p.average)}`).join(' ');

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label={t('chartTitle')}
    >
      {targetKg !== null && (
        <g>
          <line
            x1={PAD}
            x2={W - PAD}
            y1={y(targetKg)}
            y2={y(targetKg)}
            stroke="var(--tg-theme-hint-color)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <text
            x={W - PAD}
            y={y(targetKg) - 4}
            textAnchor="end"
            fontSize="9"
            fill="var(--tg-theme-hint-color)"
          >
            {t('chartTarget', { kg: targetKg })}
          </text>
        </g>
      )}

      {/* Заливка под линией: она не несёт своих данных, но отделяет тренд
          от точек взвешиваний — на графике из шестидесяти точек ломаная
          иначе теряется среди них */}
      <defs>
        <linearGradient id="weight-fill" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor="var(--tg-theme-button-color)"
            stopOpacity="0.18"
          />
          <stop
            offset="100%"
            stopColor="var(--tg-theme-button-color)"
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      <polygon
        points={`${line} ${W - PAD},${H} ${PAD},${H}`}
        fill="url(#weight-fill)"
      />

      <polyline
        points={line}
        fill="none"
        stroke="var(--tg-theme-button-color)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {points.map((p) => (
        <circle
          key={p.date}
          cx={x(Date.parse(p.date))}
          cy={y(p.raw)}
          r="1.8"
          // Тем же цветом, что и линия: это одни и те же взвешивания,
          // а серые точки читались как посторонний слой
          fill="var(--tg-theme-button-color)"
          opacity="0.45"
        />
      ))}

      {/* Последнее взвешивание отмечено отдельно: на графике за квартал
          глаз ищет прежде всего «где я сейчас» */}
      {points.length > 0 && (
        <circle
          cx={x(Date.parse(points[points.length - 1].date))}
          cy={y(points[points.length - 1].average)}
          r="3.5"
          fill="var(--tg-theme-button-color)"
          stroke="var(--tg-theme-bg-color)"
          strokeWidth="2"
        />
      )}

      <text
        x={PAD}
        y={Math.max(y(dataMax) - 4, 9)}
        fontSize="9"
        fill="var(--tg-theme-hint-color)"
      >
        {dataMax.toFixed(1)}
      </text>
      <text
        x={PAD}
        y={Math.min(y(dataMin) + 11, H - 2)}
        fontSize="9"
        fill="var(--tg-theme-hint-color)"
      >
        {dataMin.toFixed(1)}
      </text>
    </svg>
  );
}
