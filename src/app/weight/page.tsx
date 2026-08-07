'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  api,
  ApiError,
  haptic,
  useTelegramApp,
  useTelegramBack,
} from '@/lib/telegram/client';
import {
  Screen,
  Card,
  Hint,
  Button,
  Segmented,
  Field,
  Spinner,
  ErrorNote,
} from '@/components/ui';

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

const PERIODS: { value: Days; label: string }[] = [
  { value: '30', label: 'Месяц' },
  { value: '90', label: '3 месяца' },
  { value: '365', label: 'Год' },
];

export default function WeightPage() {
  const router = useRouter();
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
      setError(
        e instanceof ApiError
          ? e.message
          : 'Не удалось загрузить историю. Проверьте связь.',
      );
    }
  }, [days, router]);

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
      setFieldError('Вес от 30 до 400 кг');
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
        setError('Не удалось записать. Попробуйте ещё раз.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (error && !history) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={load}>Попробовать снова</Button>
      </Screen>
    );
  }

  if (!me || !history) {
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  }

  const { series, change, latest } = history;
  const target = me.goal?.targetWeightKg ?? null;

  return (
    <Screen>
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Вес</h1>
        {latest && (
          <span className="text-sm text-[var(--tg-theme-hint-color)]">
            {formatDate(latest.date)}
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
            <span className="text-sm text-[var(--tg-theme-hint-color)]">
              кг · среднее за неделю
            </span>
          </div>
          <span className="tabular text-sm text-[var(--tg-theme-hint-color)]">
            Последнее взвешивание {latest.raw} кг
            {target ? ` · цель ${target} кг` : ''}
          </span>
          {change !== null && (
            // Отсчёт от первой точки ряда, а не от границы выбранного
            // периода: если взвешиваний за три месяца всего две недели,
            // «за 3 месяца» приписало бы прогрессу лишний срок
            <span className="tabular mt-1 text-sm">
              {change === 0
                ? `Без изменений с ${formatDate(series[0].date)}`
                : `${change > 0 ? '+' : '−'}${Math.abs(change).toFixed(1)} кг с ${formatDate(series[0].date)}`}
            </span>
          )}
        </Card>
      ) : (
        <Card>
          <Hint>
            Первое взвешивание ещё не записано. Встаньте на весы утром натощак —
            дальше приложение покажет тренд.
          </Hint>
        </Card>
      )}

      <Segmented value={days} options={PERIODS} onChange={setDays} />

      <Card className="flex flex-col gap-2">
        {series.length >= 2 ? (
          <>
            <WeightChart points={series} targetKg={target} />
            <div className="flex justify-between text-xs text-[var(--tg-theme-hint-color)]">
              <span>{formatDate(series[0].date)}</span>
              <span>{formatDate(series[series.length - 1].date)}</span>
            </div>
          </>
        ) : (
          <Hint>
            Тренд появится со второго взвешивания: по одной точке линию не
            построить.
          </Hint>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <Field
          label={showDate ? `Вес за ${formatDate(date)}` : 'Вес сегодня'}
          unit="кг"
          value={value}
          error={fieldError}
          placeholder="80"
          onChange={(e) => setValue(e.target.value)}
        />

        {showDate && (
          <Field
            label="Дата взвешивания"
            type="date"
            value={date}
            max={me.today}
            onChange={(e) => setDate(e.target.value)}
            hint="Повторная запись за ту же дату заменит прежнюю"
          />
        )}

        <Button onClick={save} loading={saving}>
          {saved ? 'Записано' : 'Записать'}
        </Button>

        {!showDate && (
          <Button variant="ghost" onClick={() => setShowDate(true)}>
            Записать за другой день
          </Button>
        )}
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Hint>
        Взвешивайтесь в одно и то же время — утром, натощак, до завтрака.
        Сравнивать имеет смысл только средние: между вчера и сегодня разница
        почти всегда про воду, а не про жир.
      </Hint>
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
      aria-label="График веса"
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
            цель {targetKg}
          </text>
        </g>
      )}

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
          fill="var(--tg-theme-hint-color)"
        />
      ))}

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

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(y, m - 1, d));
}
