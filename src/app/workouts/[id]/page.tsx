'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

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
  Field,
  Spinner,
  ErrorNote,
} from '@/components/ui';
import { useDates } from '@/i18n/dates';

interface WorkoutSet {
  id: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  previousBest: { weightKg: number; reps: number } | null;
}

interface Workout {
  id: string;
  performedOn: string;
  durationMin: number | null;
  note: string | null;
  volumeKg: number;
  estimatedBurnKcal: number | null;
  sets: WorkoutSet[];
}

interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string | null;
}

const GROUPS = ['legs', 'chest', 'back', 'shoulders', 'arms', 'core', 'cardio'];

export default function WorkoutPage() {
  const router = useRouter();
  const { id: workoutId } = useParams<{ id: string }>();
  const t = useTranslations('workouts');
  const tc = useTranslations('common');
  const dates = useDates();

  useTelegramApp();
  useTelegramBack(useCallback(() => router.replace('/workouts'), [router]));

  const [workout, setWorkout] = useState<Workout | null>(null);
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Exercise | null>(null);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const [duration, setDuration] = useState('');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<Workout>(`/api/workouts/${workoutId}`);
      setWorkout(data);
      setDuration((prev) => prev || (data.durationMin ? String(data.durationMin) : ''));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('loadFailed'));
    }
  }, [workoutId, tc]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  /**
   * Длительность сохраняется с задержкой, а не по кнопке: это единственное
   * поле тренировки, и отдельная кнопка «сохранить» под ним выглядела бы
   * тяжелее самой записи.
   */
  useEffect(() => {
    if (!workout) return;
    const minutes = duration ? Number(duration) : null;
    if (minutes === (workout.durationMin ?? null)) return;
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 1 || minutes > 600)) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        await api(`/api/workouts/${workoutId}`, {
          method: 'PATCH',
          body: JSON.stringify({ durationMin: minutes }),
        });
        await load();
      } catch {
        // Длительность — справочное поле: не сохранилась, и ладно.
        // Ронять из-за неё запись подходов незачем
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [duration, workout, workoutId, load]);

  async function openPicker() {
    setPicking(true);
    if (exercises) return;
    try {
      const data = await api<{ exercises: Exercise[] }>('/api/exercises');
      setExercises(data.exercises);
    } catch {
      setExercises([]);
    }
  }

  async function addSet() {
    if (!chosen) return;
    const weightValue = weight ? Number(weight.replace(',', '.')) : null;
    const repsValue = reps ? Number(reps) : null;

    setBusy(true);
    setError(null);
    try {
      await api(`/api/workouts/${workoutId}/sets`, {
        method: 'POST',
        body: JSON.stringify({
          exerciseId: chosen.id,
          weightKg: weightValue,
          reps: repsValue,
        }),
      });
      haptic('success');
      // Вес и повторы остаются в полях: следующий подход почти всегда
      // тот же самый, и стирать их — заставлять набирать заново
      await load();
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : t('addFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function removeSet(setId: string) {
    haptic('tap');
    try {
      await api(`/api/workouts/${workoutId}/sets/${setId}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('saveFailed'));
    }
  }

  async function removeWorkout() {
    setBusy(true);
    try {
      await api(`/api/workouts/${workoutId}`, { method: 'DELETE' });
      haptic('success');
      router.replace('/workouts');
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : tc('saveFailed'));
      setBusy(false);
    }
  }

  if (error && !workout) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={load}>{tc('retry')}</Button>
      </Screen>
    );
  }

  if (!workout) {
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  }

  // Подходы группируются по упражнению: в зале смотрят «что я делаю сейчас»,
  // а не сплошной хронологический список
  const byExercise = workout.sets.reduce<Record<string, WorkoutSet[]>>(
    (acc, set) => {
      (acc[set.exerciseId] ??= []).push(set);
      return acc;
    },
    {},
  );

  return (
    <Screen>
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">
          {dates.dayMonth(workout.performedOn)}
        </h1>
        {workout.volumeKg > 0 && (
          <span className="tabular text-sm text-[var(--tg-theme-hint-color)]">
            {workout.volumeKg.toLocaleString('ru-RU')} {tc('kg')}
          </span>
        )}
      </header>

      <Card className="flex items-center justify-between gap-3">
        <span className="text-sm text-[var(--tg-theme-hint-color)]">
          {t('duration')}
        </span>
        <span className="flex w-28 items-center gap-2">
          <input
            value={duration}
            inputMode="numeric"
            placeholder="60"
            aria-label={t('duration')}
            onChange={(e) => setDuration(e.target.value)}
            className="tabular min-h-11 w-full rounded-xl bg-[var(--tg-theme-bg-color)] px-3 text-center text-base outline-none"
          />
          <span className="text-sm text-[var(--tg-theme-hint-color)]">
            {t('min')}
          </span>
        </span>
      </Card>

      <section className="flex flex-col gap-2">
        {Object.entries(byExercise).map(([exerciseId, sets]) => (
          <Card key={exerciseId} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{sets[0].exerciseName}</span>
              {sets[0].previousBest && (
                // Прошлый результат — то, от чего человек отталкивается:
                // смысл журнала в том, чтобы сегодня сделать больше
                <span className="tabular shrink-0 text-xs text-[var(--tg-theme-hint-color)]">
                  {t('previous', {
                    weight: sets[0].previousBest.weightKg,
                    reps: sets[0].previousBest.reps,
                  })}
                </span>
              )}
            </div>

            {sets.map((set, index) => (
              <div
                key={set.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <span className="tabular text-[var(--tg-theme-hint-color)]">
                  {index + 1}
                </span>
                <span className="tabular flex-1">
                  {set.weightKg
                    ? t('setLine', { weight: set.weightKg, reps: set.reps ?? 0 })
                    : t('setReps', { reps: set.reps ?? 0 })}
                </span>
                <button
                  type="button"
                  onClick={() => removeSet(set.id)}
                  aria-label={tc('remove')}
                  className="min-h-9 w-9 shrink-0 rounded-lg text-[var(--tg-theme-hint-color)] active:opacity-60"
                >
                  ✕
                </button>
              </div>
            ))}
          </Card>
        ))}
      </section>

      {/* Запись подхода: упражнение выбирается один раз и остаётся выбранным,
          дальше между подходами меняются только вес и повторы */}
      <Card className="flex flex-col gap-3">
        {chosen ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{chosen.name}</span>
              <button
                type="button"
                onClick={() => {
                  setChosen(null);
                  openPicker();
                }}
                className="shrink-0 text-sm text-[var(--tg-theme-link-color)]"
              >
                {t('change')}
              </button>
            </div>

            <div className="flex gap-2">
              <span className="flex-1">
                <Field
                  label={t('weight')}
                  unit={tc('kg')}
                  value={weight}
                  placeholder="60"
                  onChange={(e) => setWeight(e.target.value)}
                />
              </span>
              <span className="flex-1">
                <Field
                  label={t('reps')}
                  inputMode="numeric"
                  value={reps}
                  placeholder="8"
                  onChange={(e) => setReps(e.target.value)}
                />
              </span>
            </div>

            <Button onClick={addSet} loading={busy} disabled={!reps}>
              {t('addSet')}
            </Button>
          </>
        ) : picking && exercises ? (
          <ul className="flex max-h-96 flex-col overflow-y-auto">
            {GROUPS.map((group) => {
              const inGroup = exercises.filter((e) => e.muscleGroup === group);
              if (inGroup.length === 0) return null;
              return (
                <li key={group}>
                  <span className="block px-1 pt-3 pb-1 text-xs text-[var(--tg-theme-hint-color)]">
                    {t(`groups.${group}` as 'groups.legs')}
                  </span>
                  {inGroup.map((exercise) => (
                    <button
                      key={exercise.id}
                      type="button"
                      onClick={() => {
                        haptic('select');
                        setChosen(exercise);
                        setPicking(false);
                      }}
                      className="flex min-h-12 w-full items-center justify-between gap-2 border-b border-[var(--tg-theme-bg-color)] text-left last:border-0"
                    >
                      <span>{exercise.name}</span>
                      {exercise.equipment && (
                        <span className="shrink-0 text-xs text-[var(--tg-theme-hint-color)]">
                          {exercise.equipment}
                        </span>
                      )}
                    </button>
                  ))}
                </li>
              );
            })}
          </ul>
        ) : (
          <Button variant="ghost" onClick={openPicker}>
            {t('addExercise')}
          </Button>
        )}
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}

      {/* Расход показан справочно и к норме не добавляется: тренировки уже
          учтены коэффициентом активности, второй учёт создал бы дефицит,
          которого нет */}
      {workout.estimatedBurnKcal !== null && (
        <Hint>
          {t('burn', { kcal: workout.estimatedBurnKcal })} {t('burnHint')}
        </Hint>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <Button onClick={() => router.replace('/workouts')}>{t('done')}</Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => (armed ? removeWorkout() : setArmed(true))}
        >
          {armed ? t('deleteConfirm') : t('delete')}
        </Button>
      </div>
    </Screen>
  );
}
