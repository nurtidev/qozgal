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
  useMainButton,
} from '@/lib/telegram/client';
import {
  Screen,
  Card,
  Hint,
  Button,
  Field,
  ScreenSkeleton,
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

interface PlannedExercise {
  exerciseId: string;
  name: string;
  muscleGroup: string;
  sets: number;
  repMin: number | null;
  repMax: number | null;
  durationMin: number | null;
  restSec: number | null;
  /** Сколько подходов уже записано в этой тренировке */
  doneSets: number;
  conflicts: Conflict[];
}

interface PlanDay {
  id: string;
  dayIndex: number;
  focus: string;
  exercises: PlannedExercise[];
}

interface Workout {
  id: string;
  performedOn: string;
  durationMin: number | null;
  note: string | null;
  volumeKg: number;
  estimatedBurnKcal: number | null;
  /** Заполнен, если тренировка идёт по программе */
  planDay: PlanDay | null;
  sets: WorkoutSet[];
}

interface Conflict {
  area: string;
  severity: 'watch' | 'pain' | 'medical';
}

interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  equipment: string | null;
  /** Задетые травмы: непустой список — упражнение нагружает больное место */
  conflicts: Conflict[];
}

const GROUPS = ['legs', 'chest', 'back', 'shoulders', 'arms', 'core', 'cardio'];

export default function WorkoutPage() {
  const router = useRouter();
  const { id: workoutId } = useParams<{ id: string }>();
  const t = useTranslations('workouts');
  const tc = useTranslations('common');
  const ti = useTranslations('injuries');
  const tp = useTranslations('program');
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

  useMainButton({
    text: t('done'),
    onClick: () => router.replace('/workouts'),
    visible: workout !== null,
  });

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
        <ScreenSkeleton />
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
        <h1 className="t-title">
          {dates.dayMonth(workout.performedOn)}
        </h1>
        {workout.volumeKg > 0 && (
          <span className="t-caption tabular">
            {workout.volumeKg.toLocaleString('ru-RU')} {tc('kg')}
          </span>
        )}
      </header>

      {/* План дня — чек-лист, а не отдельный экран: в зале переключаться
          между «что делать» и «куда записать» неудобно, а тап по строке
          сразу выбирает упражнение для записи подхода */}
      {workout.planDay && (
        <Card className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium">{t('planDay')}</span>
            <span className="t-caption">
              {tp('day', { index: workout.planDay.dayIndex })} ·{' '}
              {tp(`focus.${workout.planDay.focus}` as 'focus.push')}
            </span>
          </div>

          <ul className="flex flex-col">
            {workout.planDay.exercises.map((planned) => {
              const complete = planned.doneSets >= planned.sets;
              return (
                <li key={planned.exerciseId}>
                  <button
                    type="button"
                    onClick={() => {
                      haptic('select');
                      setChosen({
                        id: planned.exerciseId,
                        name: planned.name,
                        muscleGroup: planned.muscleGroup,
                        equipment: null,
                        conflicts: planned.conflicts,
                      });
                      setPicking(false);
                    }}
                    className="flex min-h-11 w-full items-baseline justify-between gap-2 border-b border-[var(--tg-theme-hint-color)]/15 py-1 text-left last:border-0"
                  >
                    <span className="flex items-baseline gap-2">
                      <span
                        className={`tabular text-xs ${
                          complete
                            ? 'text-[var(--tg-theme-link-color)]'
                            : 'text-[var(--tg-theme-hint-color)]'
                        }`}
                      >
                        {complete
                          ? '✓'
                          : t('planDone', {
                              done: planned.doneSets,
                              total: planned.sets,
                            })}
                      </span>
                      <span className={`text-sm ${complete ? 'opacity-50' : ''}`}>
                        {planned.name}
                      </span>
                    </span>
                    <span className="t-caption tabular shrink-0">
                      {planned.durationMin
                        ? tp('doseMin', { min: planned.durationMin })
                        : tp('dose', {
                            sets: planned.sets,
                            repMin: planned.repMin ?? 0,
                            repMax: planned.repMax ?? 0,
                          })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card className="flex items-center justify-between gap-3">
        <span className="t-caption">
          {t('duration')}
        </span>
        <span className="flex w-28 items-center gap-2">
          <input
            value={duration}
            inputMode="numeric"
            placeholder="60"
            aria-label={t('duration')}
            onChange={(e) => setDuration(e.target.value)}
            className="tabular min-h-11 w-full rounded-[var(--radius-control)] bg-[var(--tg-theme-bg-color)] px-3 text-center text-base outline-none"
          />
          <span className="t-caption">
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
                <span className="t-caption tabular shrink-0">
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
                className="shrink-0 text-[14px] text-[var(--tg-theme-link-color)]"
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
            {/* Предупреждение стоит над списком: человек должен понимать
                правило до того, как увидит пометки на упражнениях */}
            {exercises.some((e) => e.conflicts.length > 0) && (
              <li className="pb-2">
                <Hint>{ti('pickerWarning')}</Hint>
              </li>
            )}
            {GROUPS.map((group) => {
              // Задевающие травму уходят вниз своей группы, но остаются
              // видимыми: запрет вместо предупреждения человек обойдёт
              // мимо приложения — вместе со всем остальным учётом
              const inGroup = exercises
                .filter((e) => e.muscleGroup === group)
                .sort((a, b) => a.conflicts.length - b.conflicts.length);
              if (inGroup.length === 0) return null;
              return (
                <li key={group}>
                  <span className="t-label block px-1 pt-3 pb-1.5">
                    {t(`groups.${group}` as 'groups.legs')}
                  </span>
                  {inGroup.map((exercise) => {
                    const medical = exercise.conflicts.some(
                      (c) => c.severity === 'medical',
                    );
                    const areas = exercise.conflicts
                      .map((c) => ti(`areas.${c.area}` as 'areas.knee'))
                      .join(', ');

                    return (
                      <button
                        key={exercise.id}
                        type="button"
                        onClick={() => {
                          haptic('select');
                          setChosen(exercise);
                          setPicking(false);
                        }}
                        className="flex min-h-12 w-full items-center justify-between gap-2 border-b border-[var(--tg-theme-hint-color)]/15 py-1.5 text-left last:border-0"
                      >
                        <span className="flex flex-col">
                          <span>{exercise.name}</span>
                          {exercise.conflicts.length > 0 && (
                            <span
                              className={`text-xs leading-tight ${
                                medical
                                  ? 'text-[var(--tg-theme-destructive-text-color)]'
                                  : 'text-[var(--tg-theme-hint-color)]'
                              }`}
                            >
                              {medical
                                ? ti('loadsMedical', { areas })
                                : ti('loads', { areas })}
                            </span>
                          )}
                        </span>
                        {exercise.equipment && (
                          <span className="t-caption shrink-0">
                            {exercise.equipment}
                          </span>
                        )}
                      </button>
                    );
                  })}
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

      {/* Главное действие — кнопкой Telegram внизу окна */}
      <div className="mt-auto flex flex-col gap-2 pt-4">
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
