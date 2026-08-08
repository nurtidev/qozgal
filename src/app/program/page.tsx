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
  Segmented,
  RadioList,
  ScreenSkeleton,
  ErrorNote,
} from '@/components/ui';
import type { BodyArea, InjurySeverity } from '@/lib/health/injury';
import type { DayFocus, MovementPattern, Place } from '@/lib/health/program';

interface Conflict {
  area: BodyArea;
  severity: InjurySeverity;
}

interface PlannedExercise {
  id: string;
  exerciseId: string;
  name: string;
  equipment: string | null;
  muscleGroup: string;
  sets: number;
  repMin: number | null;
  repMax: number | null;
  durationMin: number | null;
  restSec: number | null;
  /** Считается на каждый запрос: травма могла появиться после сборки */
  conflicts: Conflict[];
}

interface PlanDay {
  id: string;
  dayIndex: number;
  focus: DayFocus;
  exercises: PlannedExercise[];
}

interface Skipped {
  pattern: MovementPattern;
  reason: 'injury' | 'equipment';
  areas: BodyArea[];
}

interface Program {
  id: string;
  daysPerWeek: number;
  place: Place;
  nextDayIndex: number;
  days: PlanDay[];
  skipped: Skipped[];
}

const DAY_CHOICES = ['2', '3', '4', '5', '6'];

/**
 * Программа тренировок.
 *
 * Собрана справочником, а не моделью, и экран говорит об этом прямо: то,
 * что программа воспроизводима и не подсовывает движения на больное место,
 * — её главное свойство, а не деталь реализации.
 *
 * Чего здесь намеренно нет: стартовых весов. Подобрать их по росту и весу
 * нельзя, а выдуманная цифра на штанге опаснее её отсутствия — человек
 * поверит и подойдёт к снаряду с ней.
 */
export default function ProgramPage() {
  const router = useRouter();
  const t = useTranslations('program');
  const tc = useTranslations('common');
  const ti = useTranslations('injuries');

  useTelegramApp();
  useTelegramBack(useCallback(() => router.replace('/workouts'), [router]));

  const [program, setProgram] = useState<Program | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState('3');
  const [place, setPlace] = useState<Place>('gym');
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ program: Program | null }>('/api/program');
      setProgram(data.program);
      if (data.program) {
        setDays(String(data.program.daysPerWeek));
        setPlace(data.program.place);
      }
    } catch (e) {
      setProgram(null);
      setError(e instanceof ApiError ? e.message : t('loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/program', {
        method: 'POST',
        body: JSON.stringify({ daysPerWeek: Number(days), place }),
      });
      haptic('success');
      setEditing(false);
      await load();
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : t('buildFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function start(dayId: string) {
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>('/api/workouts', {
        method: 'POST',
        body: JSON.stringify({ planDayId: dayId }),
      });
      haptic('success');
      router.push(`/workouts/${created.id}`);
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : t('startFailed'));
      setBusy(false);
    }
  }

  async function drop() {
    setBusy(true);
    try {
      await api('/api/program', { method: 'DELETE' });
      haptic('success');
      setEditing(false);
      await load();
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const nextDay = program?.days.find((d) => d.dayIndex === program.nextDayIndex);
  const showForm = editing || program === null;

  useMainButton({
    text: showForm
      ? t('build')
      : t('start', { day: t('day', { index: nextDay?.dayIndex ?? 1 }) }),
    onClick: () => (showForm ? build() : nextDay && start(nextDay.id)),
    visible: program !== undefined,
    loading: busy,
  });

  if (program === undefined) {
    return (
      <Screen>
        <ScreenSkeleton rows={3} />
      </Screen>
    );
  }

  if (showForm) {
    return (
      <Screen>
        <h1 className="text-xl font-semibold">{t('title')}</h1>

        {program === null && (
          <Card>
            <Hint>{t('empty')}</Hint>
          </Card>
        )}

        <Card className="flex flex-col gap-3">
          <span className="text-sm text-[var(--tg-theme-hint-color)]">
            {t('daysQuestion')}
          </span>
          <Segmented
            value={days}
            onChange={setDays}
            options={DAY_CHOICES.map((value) => ({ value, label: value }))}
          />
          <Hint>{t('days', { count: Number(days) })}</Hint>
        </Card>

        <Card className="flex flex-col gap-3">
          <span className="text-sm text-[var(--tg-theme-hint-color)]">
            {t('placeQuestion')}
          </span>
          <RadioList
            value={place}
            onChange={setPlace}
            options={[
              { value: 'gym' as const, label: t('places.gym'), hint: t('places.gymHint') },
              { value: 'home' as const, label: t('places.home'), hint: t('places.homeHint') },
            ]}
          />
        </Card>

        {error && <ErrorNote>{error}</ErrorNote>}

        <Hint>{t('sourceHint')}</Hint>

        {program !== null && (
          <div className="mt-auto pt-4">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {tc('back')}
            </Button>
          </div>
        )}
      </Screen>
    );
  }

  /**
   * Программа отстала от ограничений.
   *
   * Признак — именно «болит» или «врач запретил»: такие движения подбор
   * в программу не пропускает вовсе, и раз они там есть, травма появилась
   * после сборки. Пометка «беспокоит» — штатная: чистой замены не нашлось,
   * упражнение оставлено осознанно, и предлагать пересборку из-за неё
   * значит гонять человека по кругу.
   */
  const stale = program.days.some((d) =>
    d.exercises.some((e) =>
      e.conflicts.some((c) => c.severity === 'pain' || c.severity === 'medical'),
    ),
  );

  return (
    <Screen>
      <header className="flex items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-sm text-[var(--tg-theme-link-color)]"
        >
          {t('rebuild')}
        </button>
      </header>

      <Card>
        <span className="text-base">
          {t('summary', {
            days: t('days', { count: program.daysPerWeek }),
            place: t(`places.${program.place}`),
          })}
        </span>
      </Card>

      {stale && (
        <Card className="border border-[var(--tg-theme-destructive-text-color)]/30">
          <Hint>{t('staleHint')}</Hint>
        </Card>
      )}

      {error && <ErrorNote>{error}</ErrorNote>}

      <section className="flex flex-col gap-2">
        {program.days.map((day) => (
          <Card key={day.id} className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">
                {t('day', { index: day.dayIndex })} ·{' '}
                {t(`focus.${day.focus}` as 'focus.push')}
              </span>
              {day.dayIndex === program.nextDayIndex && (
                <span className="shrink-0 text-xs text-[var(--tg-theme-link-color)]">
                  {t('next')}
                </span>
              )}
            </div>

            {day.exercises.length === 0 ? (
              <Hint>{t('emptyDay')}</Hint>
            ) : (
              <ul className="flex flex-col gap-2">
                {day.exercises.map((exercise) => {
                  const medical = exercise.conflicts.some(
                    (c) => c.severity === 'medical',
                  );
                  const areas = exercise.conflicts
                    .map((c) => ti(`areas.${c.area}` as 'areas.knee'))
                    .join(', ');

                  return (
                    <li key={exercise.id} className="flex flex-col">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-sm">{exercise.name}</span>
                        <span className="tabular shrink-0 text-sm text-[var(--tg-theme-hint-color)]">
                          {exercise.durationMin
                            ? t('doseMin', { min: exercise.durationMin })
                            : t('dose', {
                                sets: exercise.sets,
                                repMin: exercise.repMin ?? 0,
                                repMax: exercise.repMax ?? 0,
                              })}
                        </span>
                      </span>
                      <span className="flex items-baseline justify-between gap-2">
                        {exercise.conflicts.length > 0 ? (
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
                        ) : (
                          <span />
                        )}
                        {exercise.restSec && (
                          <span className="tabular shrink-0 text-xs text-[var(--tg-theme-hint-color)]">
                            {t('rest', { sec: exercise.restSec })}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Ссылкой, а не кнопкой во всю ширину: четыре одинаковые кнопки
                превращают программу в четыре формы, а главное действие
                экрана и так вынесено в кнопку Telegram */}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={busy}
                onClick={() => start(day.id)}
                className="min-h-9 text-sm text-[var(--tg-theme-link-color)] active:opacity-60 disabled:opacity-40"
              >
                {t('startDay')} ›
              </button>
            </div>
          </Card>
        ))}
      </section>

      {/* Пропущенные слоты — то, чего в программе нет. Молчание тут выглядело
          бы как полная программа, а это неправда */}
      {program.skipped.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-[var(--tg-theme-hint-color)]">
            {t('skippedTitle')}
          </h2>
          <Card className="flex flex-col gap-1">
            {program.skipped.map((slot) => (
              <span
                key={`${slot.pattern}-${slot.reason}`}
                className="text-sm text-[var(--tg-theme-hint-color)]"
              >
                {slot.reason === 'injury'
                  ? t('skippedInjury', {
                      pattern: t(`patterns.${slot.pattern}` as 'patterns.squat'),
                      areas: slot.areas
                        .map((area) => ti(`areas.${area}` as 'areas.knee'))
                        .join(', '),
                    })
                  : t('skippedEquipment', {
                      pattern: t(`patterns.${slot.pattern}` as 'patterns.squat'),
                    })}
              </span>
            ))}
          </Card>
          <Hint>{t('skippedHint')}</Hint>
        </section>
      )}

      <Hint>{t('weightHint')}</Hint>
      <Hint>{t('sourceHint')}</Hint>
      <Hint>{t('levelHint')}</Hint>

      <div className="mt-auto flex flex-col gap-2 pt-4">
        <Button
          variant="danger"
          disabled={busy}
          onClick={() => (armed ? drop() : setArmed(true))}
        >
          {armed ? t('deleteConfirm') : t('delete')}
        </Button>
      </div>
    </Screen>
  );
}
