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
import type { DayFocus, MovementPattern } from '@/lib/health/program';

interface Conflict {
  area: BodyArea;
  severity: InjurySeverity;
}

type Advice =
  | { kind: 'increase'; deltaKg: number | null }
  | { kind: 'hold' }
  | { kind: 'replace' };

interface PlannedExercise {
  id: string;
  /** Что делать с весом в этот раз — считается по журналу прошлых тренировок */
  advice: Advice | null;
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
  equipment: string[];
  nextDayIndex: number;
  days: PlanDay[];
  skipped: Skipped[];
}

const DAY_CHOICES = ['2', '3', '4', '5', '6'];

/**
 * Инвентарь списком, а не переключателем «зал или дом».
 *
 * Тот врал в обе стороны: дома у одного гантели и турник, у другого коврик,
 * и домашние программы выходили одинаковыми у всех. Порядок — от того, что
 * решает больше всего, к тому, что решает меньше.
 */
const EQUIPMENT_CHOICES = [
  'штанга',
  'тренажёр',
  'гантели',
  'турник',
  'брусья',
  'скакалка',
] as const;

/** Пресеты: шесть касаний превращаются в одно */
const GYM_PRESET = ['штанга', 'тренажёр', 'гантели', 'турник', 'брусья', 'скакалка'];
const HOME_PRESET = ['гантели', 'турник'];

/** Области тела для быстрой отметки ограничений */
const AREA_CHOICES: BodyArea[] = [
  'lower_back',
  'knee',
  'shoulder',
  'neck',
  'elbow',
  'wrist',
  'hip',
  'ankle',
];

const STEPS = ['days', 'equipment', 'limits'] as const;

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
  /**
   * Есть ли физданные. Без них программу не собрать: уровень берётся
   * из образа жизни, а диапазоны повторов — из цели по весу. Проверяем
   * до первого вопроса, иначе человек проходит три шага и получает отказ
   * на последнем — самый обидный способ узнать, что делать надо было другое.
   */
  const [needsProfile, setNeedsProfile] = useState(false);
  const [editing, setEditing] = useState(false);
  const [days, setDays] = useState('3');
  /**
   * Онбординг из трёх коротких шагов вместо одной формы.
   *
   * Форма со всеми вопросами сразу читается как анкета, а анкету закрывают.
   * Один вопрос на экран, ответы кнопками, ничего не нужно печатать —
   * человек проходит его за три касания, а не за пять минут раздумий.
   */
  const [step, setStep] = useState(0);
  const [equipment, setEquipment] = useState<string[]>([...GYM_PRESET]);
  /** Что беспокоит: область → степень. Пустой набор — здоров */
  const [complaints, setComplaints] = useState<Record<string, InjurySeverity>>({});
  const [busy, setBusy] = useState(false);
  /** id заменяемого упражнения — блокируем только его строку, а не экран */
  const [swapping, setSwapping] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const me = await api<{ needsOnboarding: boolean }>('/api/me');
      setNeedsProfile(me.needsOnboarding);

      const data = await api<{ program: Program | null }>('/api/program');
      setProgram(data.program);
      if (data.program) {
        setDays(String(data.program.daysPerWeek));
        // У планов, собранных до появления списка, инвентаря нет —
        // тогда оставляем предложенный по умолчанию
        if (data.program.equipment?.length) setEquipment(data.program.equipment);
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
      /**
       * Отмеченные жалобы заводятся ограничениями до сборки, а не после:
       * подбор читает их из журнала, и если записать после, первая программа
       * соберётся без учёта того, что человек только что сказал.
       */
      for (const [area, severity] of Object.entries(complaints)) {
        await api('/api/injuries', {
          method: 'POST',
          body: JSON.stringify({ area, severity }),
        });
      }

      await api('/api/program', {
        method: 'POST',
        body: JSON.stringify({ daysPerWeek: Number(days), equipment }),
      });
      haptic('success');
      setEditing(false);
      setStep(0);
      setComplaints({});
      await load();
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : t('buildFailed'));
    } finally {
      setBusy(false);
    }
  }

  /** Инвентарь: отметка снимается повторным нажатием */
  function toggleEquipment(item: string) {
    haptic('tap');
    setEquipment((current) =>
      current.includes(item)
        ? current.filter((value) => value !== item)
        : [...current, item],
    );
  }

  /**
   * Жалоба на область.
   *
   * Первое нажатие ставит «беспокоит» — самую мягкую степень: человек,
   * который просто отметил колено, не имел в виду врачебный запрет.
   * Дальше степень уточняется отдельным выбором.
   */
  function toggleComplaint(area: BodyArea) {
    haptic('tap');
    setComplaints((current) => {
      if (area in current) {
        const next = { ...current };
        delete next[area];
        return next;
      }
      return { ...current, [area]: 'watch' };
    });
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

  /**
   * Замена упражнения.
   *
   * Обновляется вся программа, а не одна строка: замена может задеть выбор
   * в других днях — подбор избегает движений, уже занятых рядом.
   */
  async function swap(planExerciseId: string) {
    setSwapping(planExerciseId);
    setError(null);
    try {
      await api(`/api/program/exercises/${planExerciseId}`, { method: 'POST' });
      haptic('success');
      await load();
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : t('swapFailed'));
    } finally {
      setSwapping(null);
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

  const lastStep = step === STEPS.length - 1;

  useMainButton({
    text: needsProfile
      ? t('fillProfile')
      : showForm
        ? lastStep
          ? t('build')
          : tc('next')
        : t('start', { day: t('day', { index: nextDay?.dayIndex ?? 1 }) }),
    onClick: () => {
      if (needsProfile) {
        router.push('/onboarding');
        return;
      }
      if (!showForm) {
        if (nextDay) start(nextDay.id);
        return;
      }
      if (lastStep) build();
      else setStep(step + 1);
    },
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

  if (needsProfile) {
    return (
      <Screen>
        <h1 className="t-title">{t('title')}</h1>
        <Card>
          <Hint>{t('needsProfile')}</Hint>
        </Card>
      </Screen>
    );
  }

  if (showForm) {
    return (
      <Screen>
        {/* Полоска шагов: человек видит, что вопросов три, а не бесконечно */}
        <div className="flex gap-1.5">
          {STEPS.map((_, index) => (
            <span
              key={index}
              className={`h-1 flex-1 rounded-full ${
                index <= step
                  ? 'bg-[var(--tg-theme-button-color)]'
                  : 'bg-[var(--tg-theme-secondary-bg-color)]'
              }`}
            />
          ))}
        </div>

        <h1 className="t-title">{t(`steps.${STEPS[step]}`)}</h1>

        {step === 0 && (
          <>
            <Card className="flex flex-col gap-3">
              <Segmented
                value={days}
                onChange={setDays}
                options={DAY_CHOICES.map((value) => ({ value, label: value }))}
              />
              <Hint>{t('days', { count: Number(days) })}</Hint>
            </Card>
            <Hint>{t('daysHint')}</Hint>
          </>
        )}

        {step === 1 && (
          <>
            {/* Пресеты первыми: шесть отметок превращаются в одну.
                Большинство отвечает «полный зал» или «дома с гантелями»,
                и заставлять их отмечать по одному — лишняя работа */}
            <div className="flex gap-2">
              <Button
                variant={
                  equipment.length === GYM_PRESET.length ? 'primary' : 'ghost'
                }
                onClick={() => {
                  haptic('tap');
                  setEquipment([...GYM_PRESET]);
                }}
              >
                {t('presets.gym')}
              </Button>
              <Button
                variant={
                  equipment.length === HOME_PRESET.length &&
                  HOME_PRESET.every((item) => equipment.includes(item))
                    ? 'primary'
                    : 'ghost'
                }
                onClick={() => {
                  haptic('tap');
                  setEquipment([...HOME_PRESET]);
                }}
              >
                {t('presets.home')}
              </Button>
            </div>

            <Card className="flex flex-col">
              {EQUIPMENT_CHOICES.map((item, index) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleEquipment(item)}
                  className={`flex min-h-11 items-center justify-between gap-3 text-left ${
                    index < EQUIPMENT_CHOICES.length - 1
                      ? 'border-b border-[var(--tg-theme-hint-color)]/15'
                      : ''
                  }`}
                >
                  <span className="t-body">{t(`equipment.${item}` as 'equipment.гантели')}</span>
                  <span className="t-caption shrink-0">
                    {equipment.includes(item) ? '✓' : ''}
                  </span>
                </button>
              ))}
            </Card>

            {/* Своё тело не спрашиваем: отжимания и планка доступны всегда,
                и лишний пункт «без инвентаря» только запутывал бы */}
            <Hint>
              {equipment.length === 0 ? t('equipmentNone') : t('equipmentHint')}
            </Hint>
          </>
        )}

        {step === 2 && (
          <>
            <Card className="flex flex-col">
              {AREA_CHOICES.map((area, index) => (
                <div
                  key={area}
                  className={
                    index < AREA_CHOICES.length - 1
                      ? 'border-b border-[var(--tg-theme-hint-color)]/15'
                      : ''
                  }
                >
                  <button
                    type="button"
                    onClick={() => toggleComplaint(area)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
                  >
                    <span className="t-body">
                      {ti(`areas.${area}` as 'areas.knee')}
                    </span>
                    <span className="t-caption shrink-0">
                      {area in complaints ? '✓' : ''}
                    </span>
                  </button>

                  {/* Степень спрашиваем только у отмеченного: показывать три
                      варианта у каждой из восьми областей значит превратить
                      шаг в таблицу из двадцати четырёх кнопок */}
                  {area in complaints && (
                    <div className="pb-3">
                      <Segmented
                        value={complaints[area]}
                        onChange={(severity) =>
                          setComplaints((current) => ({
                            ...current,
                            [area]: severity as InjurySeverity,
                          }))
                        }
                        // Короткие подписи: в сегменте на три доли «врач
                        // запретил» переносится на три строки
                        options={[
                          { value: 'watch', label: ti('severitiesShort.watch') },
                          { value: 'pain', label: ti('severitiesShort.pain') },
                          { value: 'medical', label: ti('severitiesShort.medical') },
                        ]}
                      />
                    </div>
                  )}
                </div>
              ))}
            </Card>

            <Hint>
              {Object.keys(complaints).length === 0
                ? t('limitsNone')
                : t('limitsHint')}
            </Hint>
          </>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}

        <div className="mt-auto flex flex-col gap-2 pt-4">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep(step - 1)}>
              {tc('back')}
            </Button>
          )}
          {step === 0 && program !== null && (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              {tc('back')}
            </Button>
          )}
        </div>
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
        <h1 className="t-title">{t('title')}</h1>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 text-[14px] text-[var(--tg-theme-link-color)]"
        >
          {t('rebuild')}
        </button>
      </header>

      <Card>
        <span className="text-base">
          {t('summary', {
            days: t('days', { count: program.daysPerWeek }),
            // Инвентарь перечисляем словами: «в зале» ничего не говорило
            // о том, с чем именно собрана программа
            place:
              program.equipment.length > 0
                ? program.equipment
                    .map((item) => t(`equipment.${item}` as 'equipment.гантели'))
                    .join(', ')
                    .toLowerCase()
                : t('equipmentBodyweight'),
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
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="t-body">{exercise.name}</span>

                        <span className="flex shrink-0 items-baseline gap-1">
                          {/* Доза и отдых одной строкой: отдельная строка
                              «отдых 120 с» повторялась под каждым упражнением
                              и превращала список в частокол одинаковых слов */}
                          <span className="t-caption tabular">
                            {exercise.durationMin
                              ? t('doseMin', { min: exercise.durationMin })
                              : t('dose', {
                                  sets: exercise.sets,
                                  repMin: exercise.repMin ?? 0,
                                  repMax: exercise.repMax ?? 0,
                                })}
                            {exercise.restSec
                              ? ` · ${t('rest', { sec: exercise.restSec })}`
                              : ''}
                          </span>

                          {/* Значком, а не словом: «Заменить» под каждой
                              строкой давало семь одинаковых слов в столбик
                              на день — тот же частокол, от которого избавлена
                              строка отдыха. Кардио пропущено: слот один,
                              а минуты не зависят от снаряда */}
                          {!exercise.durationMin && (
                            <button
                              type="button"
                              disabled={busy || swapping !== null}
                              onClick={() => swap(exercise.id)}
                              aria-label={t('swap')}
                              className="-my-1 -mr-1 flex h-7 w-7 items-center justify-center rounded-lg text-[var(--tg-theme-link-color)] active:opacity-60 disabled:opacity-30"
                            >
                              <SwapIcon busy={swapping === exercise.id} />
                            </button>
                          )}
                        </span>
                      </span>

                      {exercise.conflicts.length > 0 && (
                        <span
                          className={`text-[12px] leading-4 ${
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

                      {/* Совет по весу — из журнала прошлых тренировок.
                          Только предложение: программу, которая меняет вес
                          сама, человек не запомнит и не сможет проверить */}
                      {exercise.advice && (
                        <span
                          className={`text-[12px] leading-4 ${
                            exercise.advice.kind === 'replace'
                              ? 'text-[var(--tg-theme-destructive-text-color)]'
                              : 'text-[var(--tg-theme-link-color)]'
                          }`}
                        >
                          {exercise.advice.kind === 'increase'
                            ? exercise.advice.deltaKg === null
                              ? t('adviceAddRep')
                              : t('adviceAddWeight', { kg: exercise.advice.deltaKg })
                            : exercise.advice.kind === 'hold'
                              ? t('adviceHold')
                              : t('adviceReplace')}
                        </span>
                      )}
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

      {/* Один раз под всей программой, а не под каждым упражнением: смысл
          кнопки одинаков во всех днях */}
      <Hint>{t('swapHint')}</Hint>

      {/* Пропущенные слоты — то, чего в программе нет. Молчание тут выглядело
          бы как полная программа, а это неправда */}
      {program.skipped.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="t-label">
            {t('skippedTitle')}
          </h2>
          <Card className="flex flex-col gap-1">
            {program.skipped.map((slot) => (
              <span
                key={`${slot.pattern}-${slot.reason}`}
                className="t-caption"
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

/**
 * Круговая стрелка — значок замены.
 *
 * Рисуется здесь, а не берётся из шрифта: подходящих символов в IBM Plex
 * Sans нет, а подмена на запасной шрифт посреди строки видна.
 */
function SwapIcon({ busy }: { busy: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      className={busy ? 'animate-spin' : undefined}
    >
      <path d="M13.2 6.5A5.4 5.4 0 0 0 3.4 5.2" />
      <path d="M2.8 9.5a5.4 5.4 0 0 0 9.8 1.3" />
      <path d="M3.1 2.2v3h3" />
      <path d="M12.9 13.8v-3h-3" />
    </svg>
  );
}
