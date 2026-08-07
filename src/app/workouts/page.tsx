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
} from '@/lib/telegram/client';
import {
  Screen,
  Card,
  Hint,
  Button,
  Spinner,
  ErrorNote,
} from '@/components/ui';
import { useDates } from '@/i18n/dates';

interface Workout {
  id: string;
  performedOn: string;
  durationMin: number | null;
  note: string | null;
  exercises: string[];
  setCount: number;
  volumeKg: number;
}

/**
 * Журнал тренировок.
 *
 * Здесь намеренно нет калорий. Норма уже учитывает тренировки через
 * коэффициент активности в TDEE, и показать рядом «сожжено 400 ккал»
 * значило бы предложить их съесть — второй раз за ту же работу.
 */
export default function WorkoutsPage() {
  const router = useRouter();
  const t = useTranslations('workouts');
  const tc = useTranslations('common');
  const dates = useDates();

  useTelegramApp();
  useTelegramBack(useCallback(() => router.replace('/'), [router]));

  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ workouts: Workout[] }>('/api/workouts');
      setWorkouts(data.workouts);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('loadFailed'));
    }
  }, [tc]);

  useEffect(() => {
    load();
  }, [load]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const created = await api<{ id: string }>('/api/workouts', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      haptic('success');
      router.push(`/workouts/${created.id}`);
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : t('startFailed'));
      setStarting(false);
    }
  }

  useMainButton({
    text: t('start'),
    onClick: start,
    visible: workouts !== null,
    loading: starting,
  });

  if (error && !workouts) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={load}>{tc('retry')}</Button>
      </Screen>
    );
  }

  if (!workouts) {
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  }

  const weekVolume = workouts
    .filter((w) => withinDays(w.performedOn, 7))
    .reduce((sum, w) => sum + w.volumeKg, 0);

  return (
    <Screen>
      <h1 className="text-xl font-semibold">{t('title')}</h1>

      {workouts.length > 0 && (
        <Card className="flex items-baseline justify-between">
          <span className="text-sm text-[var(--tg-theme-hint-color)]">
            {t('weekVolume')}
          </span>
          <span className="tabular text-lg font-medium">
            {weekVolume.toLocaleString('ru-RU')} {tc('kg')}
          </span>
        </Card>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      {workouts.length === 0 ? (
        <Card>
          <Hint>{t('empty')}</Hint>
        </Card>
      ) : (
        <section className="flex flex-col gap-2">
          {workouts.map((workout) => (
            <button
              key={workout.id}
              onClick={() => router.push(`/workouts/${workout.id}`)}
              className="w-full text-left"
            >
              <Card className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {dates.dayMonth(workout.performedOn)}
                  </span>
                  <span className="tabular text-sm">
                    {workout.volumeKg > 0
                      ? `${workout.volumeKg.toLocaleString('ru-RU')} ${tc('kg')}`
                      : t('noVolume')}
                  </span>
                </div>
                <span className="truncate text-sm text-[var(--tg-theme-hint-color)]">
                  {workout.exercises.length > 0
                    ? workout.exercises.join(' · ')
                    : t('emptyWorkout')}
                </span>
                {workout.setCount > 0 && (
                  <span className="tabular text-xs text-[var(--tg-theme-hint-color)]">
                    {t('sets', { count: workout.setCount })}
                    {workout.durationMin
                      ? ` · ${t('minutes', { count: workout.durationMin })}`
                      : ''}
                  </span>
                )}
              </Card>
            </button>
          ))}
        </section>
      )}

      <Hint>{t('caloriesHint')}</Hint>
    </Screen>
  );
}

/** Дата не старше N дней. Разбор по частям — Date из строки берёт UTC */
function withinDays(iso: string, days: number): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return false;
  const edge = new Date();
  edge.setDate(edge.getDate() - days);
  return new Date(y, m - 1, d).getTime() >= edge.setHours(0, 0, 0, 0);
}
