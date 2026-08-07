'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { api, ApiError, useTelegramApp } from '@/lib/telegram/client';
import { useDates } from '@/i18n/dates';
import {
  Screen,
  Card,
  Hint,
  Button,
  CalorieRing,
  MacroBar,
  ScreenSkeleton,
  ErrorNote,
} from '@/components/ui';

interface Me {
  user: { firstName: string | null };
  needsOnboarding: boolean;
  today: string;
  goal: {
    kcalTarget: number;
    proteinTargetG: number;
    fatTargetG: number;
    carbTargetG: number;
  } | null;
  todayTotals: { kcal: number; proteinG: number; fatG: number; carbsG: number };
  weight: { kg: number; loggedOn: string } | null;
}

interface DayItem {
  id: string;
  name: string;
  grams: number;
  kcal: number;
  hasNutrition: boolean;
}

interface DayEntry {
  id: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  status: 'pending' | 'confirmed' | 'discarded';
  kcal: number;
  items: DayItem[];
}

interface Day {
  date: string;
  entries: DayEntry[];
  totals: { kcal: number; proteinG: number; fatG: number; carbsG: number };
}

export default function DashboardPage() {
  const router = useRouter();
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const tm = useTranslations('macros');
  const dates = useDates();
  const [me, setMe] = useState<Me | null>(null);
  const [day, setDay] = useState<Day | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const profile = await api<Me>('/api/me');
      if (profile.needsOnboarding) {
        router.replace('/onboarding');
        return;
      }
      setMe(profile);
      // «Сегодня» берём с сервера, в часовом поясе пользователя: по часам
      // телефона в поездке дневник открывался бы на завтрашнем пустом дне
      setDate((prev) => prev ?? profile.today);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('loadFailed'));
    }
  }, [router, tc]);

  useTelegramApp();

  useEffect(() => {
    load();
  }, [load]);

  // День перезагружается при каждом шаге по датам — отдельно от профиля,
  // чтобы листание не дёргало /api/me
  useEffect(() => {
    if (!date) return;
    let stale = false;
    api<Day>(`/api/day?date=${date}`)
      .then((loaded) => {
        if (!stale) setDay(loaded);
      })
      .catch((e) => {
        if (!stale) {
          setError(e instanceof ApiError ? e.message : tc('loadFailed'));
        }
      });
    // Быстрое листание оставляет запросы в полёте: ответ на позавчера,
    // пришедший последним, показал бы чужой день
    return () => {
      stale = true;
    };
  }, [date, tc]);

  if (error) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={() => { setError(null); load(); }}>{tc('retry')}</Button>
      </Screen>
    );
  }

  if (!me || !day) {
    return (
      <Screen>
        <ScreenSkeleton ring rows={2} />
      </Screen>
    );
  }

  // Черновики не входят в дневной итог, но их видно отдельно:
  // иначе разбор, оставленный без подтверждения, просто пропадал бы из виду
  const pending = day.entries.filter((e) => e.status === 'pending');
  const confirmed = day.entries.filter((e) => e.status === 'confirmed');
  const isToday = day.date === me.today;

  return (
    <Screen>
      <header className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">
          {me.user.firstName
            ? t('greeting', { name: me.user.firstName })
            : t('title')}
        </h1>

        <div className="flex items-center justify-between gap-2">
          <DayStep label="‹" title={t('prevDay')} onClick={() => setDate(shiftDate(day.date, -1))} />
          <button
            type="button"
            // Тап по дате возвращает на сегодня — короче, чем отщёлкивать
            // назад по одному дню после прогулки по неделе
            onClick={() => setDate(me.today)}
            className="flex flex-col items-center"
          >
            <span className="text-base font-medium">
              {isToday ? t('today') : dates.dayMonth(day.date)}
            </span>
            {!isToday && (
              <span className="text-xs text-[var(--tg-theme-link-color)]">
                {t('backToToday')}
              </span>
            )}
          </button>
          <DayStep
            label="›"
            title={t('nextDay')}
            // Вперёд дальше сегодняшнего дня ходить некуда: еды из будущего
            // в дневнике не бывает
            disabled={isToday}
            onClick={() => setDate(shiftDate(day.date, 1))}
          />
        </div>
      </header>

      {me.goal ? (
        <>
          <div className="fade-in flex justify-center py-2">
            <CalorieRing eaten={day.totals.kcal} target={me.goal.kcalTarget} />
          </div>

          <Card className="flex flex-col gap-3">
            <MacroBar
              label={tm('protein')}
              value={day.totals.proteinG}
              target={me.goal.proteinTargetG}
              color="var(--accent-protein)"
            />
            <MacroBar
              label={tm('fat')}
              value={day.totals.fatG}
              target={me.goal.fatTargetG}
              color="var(--accent-fat)"
            />
            <MacroBar
              label={tm('carbs')}
              value={day.totals.carbsG}
              target={me.goal.carbTargetG}
              color="var(--accent-carbs)"
            />
          </Card>
        </>
      ) : (
        <Card>
          <Hint>{t('noGoal')}</Hint>
        </Card>
      )}

      {pending.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-[var(--tg-theme-hint-color)]">
            {t('pending')}
          </h2>
          {pending.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onOpen={() => router.push(`/entry/${entry.id}`)}
            />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-[var(--tg-theme-hint-color)]">
          {isToday ? t('eatenToday') : t('eatenOn')}
        </h2>

        {confirmed.length === 0 ? (
          <Card>
            <Hint>{isToday ? t('empty') : t('emptyDay')}</Hint>
          </Card>
        ) : (
          confirmed.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onOpen={() => router.push(`/entry/${entry.id}`)}
            />
          ))
        )}
      </section>

      <section className="flex flex-col gap-2">
        <NavRow
          caption={t('weight')}
          title={
            me.weight ? `${me.weight.kg} ${tc('kg')}` : t('weightEmpty')
          }
          onOpen={() => router.push('/weight')}
        />
        <NavRow
          title={t('measurements')}
          onOpen={() => router.push('/measurements')}
        />
        <NavRow
          title={t('workouts')}
          onOpen={() => router.push('/workouts')}
        />
        <NavRow
          title={t('injuries')}
          onOpen={() => router.push('/injuries')}
        />
        <NavRow
          title={t('profile')}
          caption={me.goal ? `${me.goal.kcalTarget} ${tc('kcal')}` : undefined}
          onOpen={() => router.push('/profile')}
        />
      </section>
    </Screen>
  );
}

/** Шаг по дням. Крупная зона нажатия: стрелка сама по себе слишком мелкая */
function DayStep({
  label,
  title,
  onClick,
  disabled,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="min-h-11 w-11 shrink-0 rounded-xl bg-[var(--tg-theme-secondary-bg-color)] text-lg active:opacity-70 disabled:opacity-30"
    >
      {label}
    </button>
  );
}

/** Соседний день. Дата собирается по частям — Date из строки берёт UTC */
function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Строка-переход в раздел: название, текущее значение над ним и стрелка */
function NavRow({
  title,
  caption,
  onOpen,
}: {
  title: string;
  caption?: string;
  onOpen: () => void;
}) {
  return (
    <button onClick={onOpen} className="w-full text-left">
      <Card className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          {caption && (
            <span className="text-sm text-[var(--tg-theme-hint-color)]">
              {caption}
            </span>
          )}
          <span className="tabular text-lg font-medium">{title}</span>
        </div>
        <span className="text-lg text-[var(--tg-theme-hint-color)]">›</span>
      </Card>
    </button>
  );
}

function EntryCard({
  entry,
  onOpen,
}: {
  entry: DayEntry;
  onOpen: () => void;
}) {
  const t = useTranslations('common');
  const meals = useTranslations('meals');

  return (
    <button onClick={onOpen} className="w-full text-left">
      <Card
        className={
          entry.status === 'pending'
            ? 'border border-dashed border-[var(--tg-theme-hint-color)]/40'
            : ''
        }
      >
        <div className="flex items-baseline justify-between">
          <span className="font-medium">{meals(entry.mealType)}</span>
          <span className="tabular text-sm">
            {entry.kcal} {t('kcal')}
          </span>
        </div>
        <ul className="mt-2 flex flex-col gap-1">
          {entry.items.map((item) => (
            <li
              key={item.id}
              className="flex items-baseline justify-between text-sm text-[var(--tg-theme-hint-color)]"
            >
              <span className="truncate pr-2">{item.name}</span>
              <span className="tabular shrink-0">
                {item.grams} {t('g')}
                {/* Позиция без нутриентов не должна выглядеть как нулевая
                    калорийность — это разные вещи */}
                {!item.hasNutrition && ` · ${t('noData')}`}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </button>
  );
}
