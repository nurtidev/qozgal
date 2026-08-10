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
  Row,
  Divider,
  Hint,
  Button,
  ScreenSkeleton,
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

interface Program {
  daysPerWeek: number;
  nextDayIndex: number;
  days: { id: string; dayIndex: number; focus: string }[];
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
  const tp = useTranslations('program');
  const dates = useDates();

  useTelegramApp();
  useTelegramBack(useCallback(() => router.replace('/'), [router]));

  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
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

  // Программа грузится отдельно и молча: без неё журнал работает как прежде,
  // и ронять из-за неё экран незачем
  useEffect(() => {
    api<{ program: Program | null }>('/api/program')
      .then((data) => setProgram(data.program))
      .catch(() => setProgram(null));
  }, []);

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
        <ScreenSkeleton />
      </Screen>
    );
  }

  const weekVolume = workouts
    .filter((w) => withinDays(w.performedOn, 7))
    .reduce((sum, w) => sum + w.volumeKg, 0);

  return (
    <Screen>
      <h1 className="t-title">{t('title')}</h1>

      {/* Программа стоит выше журнала: она отвечает на вопрос «что делать
          сегодня», а журнал — на вопрос «что я уже сделал» */}
      <button
        type="button"
        onClick={() => router.push('/program')}
        className="w-full text-left"
      >
        <Card className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="t-caption">
              {program ? t('planNext', { day: nextDayLabel(program, tp) }) : t('planNone')}
            </span>
            <span className="n-m">
              {program ? t('planOpen') : t('planBuild')}
            </span>
          </span>
          <span className="text-lg text-[var(--tg-theme-hint-color)]">›</span>
        </Card>
      </button>

      {workouts.length > 0 && (
        <Card className="flex items-baseline justify-between">
          <span className="t-caption">
            {t('weekVolume')}
          </span>
          <span className="n-m">
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
        // Журнал одной ведомостью, а не столбиком карточек: тренировок
        // за месяц накапливается два десятка, и каждая в своей рамке
        // превращает список в лестницу, по которой трудно вести глазом
        <Card className="flex flex-col">
          {workouts.map((workout, index) => (
            <div key={workout.id}>
              {index > 0 && <Divider />}
              <Row
                title={dates.dayMonth(workout.performedOn)}
                caption={
                  workout.exercises.length > 0
                    ? `${workout.exercises.join(' · ')}${
                        workout.setCount > 0
                          ? ` · ${t('sets', { count: workout.setCount })}`
                          : ''
                      }`
                    : t('emptyWorkout')
                }
                value={
                  workout.volumeKg > 0
                    ? `${workout.volumeKg.toLocaleString('ru-RU')} ${tc('kg')}`
                    : undefined
                }
                trailing={
                  workout.volumeKg > 0 ? undefined : (
                    <span className="t-caption">{t('noVolume')}</span>
                  )
                }
                onClick={() => router.push(`/workouts/${workout.id}`)}
                chevron
              />
            </div>
          ))}
        </Card>
      )}

      <Hint>{t('caloriesHint')}</Hint>
    </Screen>
  );
}

/** Подпись следующего дня программы: «День 2 · Тяговый» */
function nextDayLabel(
  program: Program,
  tp: ReturnType<typeof useTranslations<'program'>>,
): string {
  const day = program.days.find((d) => d.dayIndex === program.nextDayIndex);
  if (!day) return tp('day', { index: program.nextDayIndex });
  return `${tp('day', { index: day.dayIndex })} · ${tp(`focus.${day.focus}` as 'focus.push')}`;
}

/** Дата не старше N дней. Разбор по частям — Date из строки берёт UTC */
function withinDays(iso: string, days: number): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return false;
  const edge = new Date();
  edge.setDate(edge.getDate() - days);
  return new Date(y, m - 1, d).getTime() >= edge.setHours(0, 0, 0, 0);
}
