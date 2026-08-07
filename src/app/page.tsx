'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { api, ApiError, useTelegramApp } from '@/lib/telegram/client';
import {
  Screen,
  Card,
  Hint,
  Button,
  CalorieRing,
  MacroBar,
  Spinner,
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

const MEAL_LABELS: Record<DayEntry['mealType'], string> = {
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  snack: 'Перекус',
};

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [day, setDay] = useState<Day | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const profile = await api<Me>('/api/me');
      if (profile.needsOnboarding) {
        router.replace('/onboarding');
        return;
      }
      setMe(profile);
      setDay(await api<Day>('/api/day'));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : 'Не удалось загрузить данные. Проверьте связь.',
      );
    }
  }, [router]);

  useTelegramApp();

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={() => { setError(null); load(); }}>Попробовать снова</Button>
      </Screen>
    );
  }

  if (!me || !day) {
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  }

  // Черновики не входят в дневной итог, но их видно отдельно:
  // иначе разбор, оставленный без подтверждения, просто пропадал бы из виду
  const pending = day.entries.filter((e) => e.status === 'pending');
  const confirmed = day.entries.filter((e) => e.status === 'confirmed');

  return (
    <Screen>
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">
          {me.user.firstName ? `Привет, ${me.user.firstName}` : 'Дневник'}
        </h1>
        <span className="text-sm text-[var(--tg-theme-hint-color)]">
          {formatDate(day.date)}
        </span>
      </header>

      {me.goal ? (
        <>
          <div className="fade-in flex justify-center py-2">
            <CalorieRing eaten={day.totals.kcal} target={me.goal.kcalTarget} />
          </div>

          <Card className="flex flex-col gap-3">
            <MacroBar
              label="Белки"
              value={day.totals.proteinG}
              target={me.goal.proteinTargetG}
              color="var(--accent-protein)"
            />
            <MacroBar
              label="Жиры"
              value={day.totals.fatG}
              target={me.goal.fatTargetG}
              color="var(--accent-fat)"
            />
            <MacroBar
              label="Углеводы"
              value={day.totals.carbsG}
              target={me.goal.carbTargetG}
              color="var(--accent-carbs)"
            />
          </Card>
        </>
      ) : (
        <Card>
          <Hint>Цель не задана — норма калорий не рассчитана.</Hint>
        </Card>
      )}

      {pending.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-[var(--tg-theme-hint-color)]">
            Ждут подтверждения
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
          Съедено сегодня
        </h2>

        {confirmed.length === 0 ? (
          <Card>
            <Hint>
              Записей пока нет. Пришлите боту фотографию блюда или напишите
              словами — например, «две сосиски и гречка».
            </Hint>
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
          caption="Вес"
          title={me.weight ? `${me.weight.kg} кг` : 'не записан'}
          onOpen={() => router.push('/weight')}
        />
        <NavRow
          title="Замеры тела"
          onOpen={() => router.push('/measurements')}
        />
      </section>
    </Screen>
  );
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
          <span className="font-medium">{MEAL_LABELS[entry.mealType]}</span>
          <span className="tabular text-sm">{entry.kcal} ккал</span>
        </div>
        <ul className="mt-2 flex flex-col gap-1">
          {entry.items.map((item) => (
            <li
              key={item.id}
              className="flex items-baseline justify-between text-sm text-[var(--tg-theme-hint-color)]"
            >
              <span className="truncate pr-2">{item.name}</span>
              <span className="tabular shrink-0">
                {item.grams} г
                {/* Позиция без нутриентов не должна выглядеть как нулевая
                    калорийность — это разные вещи */}
                {!item.hasNutrition && ' · нет данных'}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </button>
  );
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
  }).format(new Date(y, m - 1, d));
}
