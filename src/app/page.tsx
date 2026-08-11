'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { api, ApiError, useTelegramApp } from '@/lib/telegram/client';
import { useDates } from '@/i18n/dates';
import {
  Screen,
  Card,
  Section,
  Row,
  Divider,
  Chip,
  Hint,
  Button,
  DayArc,
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
  /** Числа взяты из непроверенной карточки справочника */
  isEstimate: boolean;
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
      {/* Шапка-приборная: слева дата, справа шаг по дням. Приветствие
          ушло в подпись — на экране, куда заходят по нескольку раз в день,
          дата важнее имени */}
      <header className="flex items-end justify-between gap-3">
        <div className="flex flex-col">
          {/* Приветствие сюда не вернулось намеренно: на экран, куда заходят
              по пять раз в день, «Привет, имя» перестаёт читаться через
              неделю, а место занимает то же, что и дата */}
          <span className="t-label">{t('title')}</span>
          <h1 className="t-title mt-0.5">
            {isToday ? t('today') : dates.dayMonth(day.date)}
          </h1>
        </div>

        <div className="flex items-center gap-1.5">
          {!isToday && (
            <button
              type="button"
              onClick={() => setDate(me.today)}
              className="t-caption min-h-9 px-2 text-[var(--tg-theme-link-color)]"
            >
              {t('backToToday')}
            </button>
          )}
          <DayStep
            label="‹"
            title={t('prevDay')}
            onClick={() => setDate(shiftDate(day.date, -1))}
          />
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
          <div className="fade-in flex justify-center py-1">
            <DayArc eaten={day.totals.kcal} target={me.goal.kcalTarget} />
          </div>

          <Card className="flex flex-col gap-3.5">
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
        <Section label={t('pending')}>
          <Card className="flex flex-col">
            {pending.map((entry, index) => (
              <div key={entry.id}>
                {index > 0 && <Divider />}
                <EntryRow
                  entry={entry}
                  pending
                  onOpen={() => router.push(`/entry/${entry.id}`)}
                />
              </div>
            ))}
          </Card>
        </Section>
      )}

      <Section label={isToday ? t('eatenToday') : t('eatenOn')}>
        {confirmed.length === 0 ? (
          <Card>
            <Hint>{isToday ? t('empty') : t('emptyDay')}</Hint>
          </Card>
        ) : (
          <Card className="flex flex-col">
            {confirmed.map((entry, index) => (
              <div key={entry.id}>
                {index > 0 && <Divider />}
                <EntryRow
                  entry={entry}
                  onOpen={() => router.push(`/entry/${entry.id}`)}
                />
              </div>
            ))}
          </Card>
        )}
      </Section>

      {/* Разделы одной группой строк, а не столбиком карточек: это переходы,
          а не показания, и каждому не нужна своя рамка */}
      <Section>
        <Card className="flex flex-col">
          <Row
            title={t('weight')}
            value={me.weight ? `${me.weight.kg} ${tc('kg')}` : t('weightEmpty')}
            valueTone={me.weight ? 'normal' : 'hint'}
            onClick={() => router.push('/weight')}
            chevron
          />
          <Divider />
          <Row
            title={t('stats')}
            onClick={() => router.push('/stats')}
            chevron
          />
          <Divider />
          <Row
            title={t('measurements')}
            onClick={() => router.push('/measurements')}
            chevron
          />
          <Divider />
          <Row
            title={t('workouts')}
            onClick={() => router.push('/workouts')}
            chevron
          />
          <Divider />
          <Row
            title={t('injuries')}
            onClick={() => router.push('/injuries')}
            chevron
          />
          <Divider />
          <Row
            title={t('profile')}
            value={me.goal ? `${me.goal.kcalTarget} ${tc('kcal')}` : undefined}
            onClick={() => router.push('/profile')}
            chevron
          />
        </Card>
      </Section>
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
      className="min-h-10 w-10 shrink-0 rounded-[var(--radius-control)] bg-[var(--tg-theme-secondary-bg-color)] text-[17px] transition-opacity active:opacity-60 disabled:opacity-30"
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

/**
 * Приём пищи строкой ведомости: название, состав одной строкой, калории.
 *
 * Состав свёрнут в перечисление вместо списка позиций — на дашборде он
 * нужен, чтобы узнать запись, а не проверить граммовку; для этого есть
 * экран записи.
 */
function EntryRow({
  entry,
  onOpen,
  pending,
}: {
  entry: DayEntry;
  onOpen: () => void;
  pending?: boolean;
}) {
  const t = useTranslations('common');
  const meals = useTranslations('meals');
  const td = useTranslations('dashboard');

  const composition = entry.items
    .map((item) => `${item.name} ${Math.round(item.grams)} ${t('g')}`)
    .join(' · ');

  // Позиция без нутриентов не должна выглядеть как нулевая калорийность —
  // это разные вещи, и на дневном итоге видно только вторую
  const unknown = entry.items.filter((item) => !item.hasNutrition).length;
  // Итог приёма пищи собран хотя бы частично из расчётных карточек
  const estimated = entry.items.some((item) => item.isEstimate);

  return (
    <Row
      title={
        <span className="flex items-center gap-2">
          {meals(entry.mealType)}
          {pending && <Chip>{td('draft')}</Chip>}
        </span>
      }
      caption={
        unknown > 0 ? `${composition} · ${t('noData')}` : composition
      }
      value={`${entry.kcal} ${t('kcal')}`}
      // Приблизительность итога помечается там же, где сам итог: иначе
      // расчётная цифра неотличима от выверенной
      trailing={estimated ? <Chip>{td('estimate')}</Chip> : undefined}
      onClick={onOpen}
      chevron
    />
  );
}
