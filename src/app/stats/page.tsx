'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import {
  api,
  ApiError,
  useTelegramApp,
  useTelegramBack,
} from '@/lib/telegram/client';
import {
  Screen,
  Card,
  Section,
  Row,
  Divider,
  Hint,
  Button,
  Segmented,
  ScreenSkeleton,
  ErrorNote,
} from '@/components/ui';
import { useDates } from '@/i18n/dates';
import { peakKcal, type DayStat, type StatsSummary } from '@/lib/health/stats';

interface Stats {
  days: DayStat[];
  goal: { kcalTarget: number } | null;
  summary: StatsSummary;
}

const PERIODS = [
  { value: '7', labelKey: 'periodWeek' },
  { value: '30', labelKey: 'periodMonth' },
  { value: '90', labelKey: 'periodQuarter' },
] as const;

/**
 * Как человек ест вообще.
 *
 * Дневник отвечает за сегодня, этот экран — за отрезок: дефицит виден
 * только на нём. Главное здесь не средние сами по себе, а то, из скольких
 * дней они собраны: среднее по восемнадцати дням из тридцати и среднее
 * по тридцати — разные утверждения, и второе честнее не показывать вовсе,
 * чем выдать за первое.
 */
export default function StatsPage() {
  const router = useRouter();
  const t = useTranslations('stats');
  const tc = useTranslations('common');
  const dates = useDates();

  useTelegramApp();
  useTelegramBack(useCallback(() => router.replace('/'), [router]));

  const [period, setPeriod] = useState('30');
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<Stats>(`/api/stats?days=${period}`);
      setStats(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('loadFailed'));
    }
  }, [period, t]);

  useEffect(() => {
    load();
  }, [load]);

  if (error && !stats) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={load}>{tc('retry')}</Button>
      </Screen>
    );
  }

  if (!stats) {
    return (
      <Screen>
        <ScreenSkeleton rows={3} />
      </Screen>
    );
  }

  const { summary, goal } = stats;
  // Пропущенные дни в списке не показываем: тридцать строк, где две трети
  // «нет записей», читаются как поломка. В графике они остаются дырами
  const logged = [...stats.days].filter((day) => day.entryCount > 0).reverse();

  return (
    <Screen>
      <header className="flex flex-col">
        <span className="t-label">{t('title')}</span>
        <h1 className="t-title mt-0.5">
          {summary.avgKcal !== null
            ? `${summary.avgKcal} ${tc('kcal')}`
            : tc('noData')}
        </h1>
        <span className="t-caption mt-0.5">{t('avgKcal')}</span>
      </header>

      <Segmented
        value={period}
        onChange={setPeriod}
        options={PERIODS.map((p) => ({ value: p.value, label: t(p.labelKey) }))}
      />

      {summary.avgKcal === null ? (
        <Card>
          <Hint>{t('empty')}</Hint>
        </Card>
      ) : (
        <>
          <Card className="flex flex-col gap-3">
            {/* Отклонение от нормы — то, ради чего экран открывают:
                оно объясняет, почему вес стоит или уходит */}
            {goal ? (
              <span className="t-body">
                {summary.avgDeviation === null || summary.avgDeviation === 0
                  ? t('atNorm')
                  : summary.avgDeviation < 0
                    ? t('belowNorm', { kcal: Math.abs(summary.avgDeviation) })
                    : t('aboveNorm', { kcal: summary.avgDeviation })}
              </span>
            ) : (
              <span className="t-caption">{t('noGoal')}</span>
            )}

            <div className="flex flex-col gap-1">
              <span className="t-caption">
                {t('logged', {
                  logged: summary.daysLogged,
                  total: summary.daysTotal,
                })}
              </span>
              {goal && (
                <span className="t-caption">
                  {t('withinNorm', { count: summary.withinNormDays })}
                </span>
              )}
              <span className="t-caption tabular">
                {t('avgMacros', {
                  protein: summary.avgProteinG ?? 0,
                  fat: summary.avgFatG ?? 0,
                  carbs: summary.avgCarbsG ?? 0,
                })}
              </span>
            </div>
          </Card>

          <Card>
            <DayChart
              days={stats.days}
              kcalTarget={goal?.kcalTarget ?? null}
              normLabel={
                goal ? t('chartNorm', { kcal: goal.kcalTarget }) : undefined
              }
            />
          </Card>

          <Hint>{t('gapsHint')}</Hint>

          <Section label={t('byDay')}>
            <Card className="flex flex-col">
              {logged.map((day, index) => (
                <div key={day.date}>
                  {index > 0 && <Divider />}
                  <Row
                    title={dates.dayMonthShort(day.date)}
                    caption={
                      goal
                        ? `${signed(day.kcal - goal.kcalTarget)} ${tc('kcal')}`
                        : undefined
                    }
                    value={`${day.kcal}`}
                  />
                </div>
              ))}
            </Card>
          </Section>
        </>
      )}
    </Screen>
  );
}

/** Знак нужен всегда: «120» и «−120» иначе не различить */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/**
 * Гистограмма по дням.
 *
 * Столбик на день, включая пустые: дыра в ряду — это факт о том, что
 * дневник забросили, и он важнее гладкости картинки. Линия нормы даёт
 * точку отсчёта, без которой высота столбиков ничего не значит.
 */
function DayChart({
  days,
  kcalTarget,
  normLabel,
}: {
  days: DayStat[];
  kcalTarget: number | null;
  normLabel?: string;
}) {
  const W = 320;
  const H = 110;
  const PAD = 8;
  const peak = peakKcal(days, kcalTarget);

  const barSpace = (W - PAD * 2) / days.length;
  // Столбик уже своей ячейки: без просвета тридцать дней сливаются
  // в сплошную заливку, по которой не прочитать отдельный день
  const barWidth = Math.max(barSpace * 0.62, 1.5);
  const y = (kcal: number) => PAD + (1 - kcal / peak) * (H - PAD * 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img">
      {kcalTarget !== null && (
        <>
          <line
            x1={PAD}
            x2={W - PAD}
            y1={y(kcalTarget)}
            y2={y(kcalTarget)}
            stroke="var(--tg-theme-hint-color)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          {normLabel && (
            // Подпись слева: справа стоят последние дни, и там она
            // наезжала на самые свежие столбики — те, которые смотрят
            // в первую очередь
            <text
              x={PAD}
              y={Math.max(y(kcalTarget) - 4, 9)}
              fontSize="9"
              fill="var(--tg-theme-hint-color)"
            >
              {normLabel}
            </text>
          )}
        </>
      )}

      {days.map((day, index) => {
        const top = y(day.kcal);
        const over = kcalTarget !== null && day.kcal > kcalTarget;

        return (
          <rect
            key={day.date}
            x={PAD + index * barSpace + (barSpace - barWidth) / 2}
            y={top}
            width={barWidth}
            height={Math.max(H - PAD - top, 0)}
            rx={barWidth / 2}
            fill={
              over
                ? 'var(--tg-theme-destructive-text-color)'
                : 'var(--tg-theme-button-color)'
            }
            opacity={day.entryCount > 0 ? 1 : 0}
          />
        );
      })}
    </svg>
  );
}
