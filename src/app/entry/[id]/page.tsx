'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import {
  api,
  ApiError,
  getWebApp,
  applyTheme,
  haptic,
} from '@/lib/telegram/client';
import {
  Screen,
  Card,
  Hint,
  Button,
  Segmented,
  Spinner,
  ErrorNote,
} from '@/components/ui';

type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

interface Item {
  id: string;
  name: string;
  grams: number;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  confidence: number | null;
  estimatedGrams: number | null;
  productId: string | null;
}

interface Entry {
  id: string;
  mealType: MealType;
  status: 'pending' | 'confirmed' | 'discarded';
  source: string;
  consumedAt: string;
  consumedOn: string;
  items: Item[];
}

const MEAL_OPTIONS: { value: MealType; label: string }[] = [
  { value: 'breakfast', label: 'Завтрак' },
  { value: 'lunch', label: 'Обед' },
  { value: 'dinner', label: 'Ужин' },
  { value: 'snack', label: 'Перекус' },
];

const SOURCE_LABELS: Record<string, string> = {
  photo: 'по фото',
  text: 'по описанию',
  manual: 'вручную',
  repeat: 'повтор',
  barcode: 'по штрихкоду',
};

/** Шаг кнопок ± — порции измеряются десятками граммов, единицы только мешают */
const STEP_G = 10;
/** Верхняя граница та же, что принимает API: больше 5 кг за приём не бывает */
const MAX_G = 5000;
/** Ниже этой уверенности модели просим проверить вес глазами */
const LOW_CONFIDENCE = 0.6;

interface Nutrition {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Нутриенты позиции при изменённой граммовке — предпросмотр до сохранения.
 *
 * Сервер для позиций со ссылкой на продукт пересчитывает от карточки
 * справочника, а не пропорцией от снапшота, поэтому его число может
 * отличаться на единицу округления. Расхождение исчезает само: после PATCH
 * экран уходит на дневник, где цифры уже серверные.
 */
function preview(item: Item, grams: number): Nutrition {
  const ratio = item.grams > 0 ? grams / item.grams : 0;
  return {
    kcal: Math.round(item.kcal * ratio),
    proteinG: round1(item.proteinG * ratio),
    fatG: round1(item.fatG * ratio),
    carbsG: round1(item.carbsG * ratio),
  };
}

/** Позиция без нутриентов — это «не нашли», а не «ноль калорий» */
const hasNutrition = (item: Item) => item.kcal > 0 || item.proteinG > 0;

/** Разбор поля ввода; null означает «править нечего, значение негодное» */
function toGrams(text: string): number | null {
  const value = Number(text.replace(',', '.').trim());
  if (!Number.isFinite(value) || value < 0 || value > MAX_G) return null;
  return Math.round(value * 10) / 10;
}

export default function EntryPage() {
  const router = useRouter();
  const { id: entryId } = useParams<{ id: string }>();

  const [entry, setEntry] = useState<Entry | null>(null);
  const [mealType, setMealType] = useState<MealType>('lunch');
  const [grams, setGrams] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  /**
   * Из бота Mini App открывается сразу на этом экране: истории нет и
   * router.back() уводил бы в пустоту. Тогда возвращаемся на дневник.
   */
  const leave = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.replace('/');
  }, [router]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<Entry>(`/api/entries/${entryId}`);
      setEntry(data);
      setMealType(data.mealType);
      setGrams(
        Object.fromEntries(data.items.map((i) => [i.id, String(i.grams)])),
      );
      setRemoved([]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
      else {
        setError(
          e instanceof ApiError
            ? e.message
            : 'Не удалось загрузить запись. Проверьте связь.',
        );
      }
    }
  }, [entryId]);

  useEffect(() => {
    const app = getWebApp();
    if (app) {
      app.ready();
      app.expand();
      applyTheme(app);
    }
    load();
  }, [load]);

  // Системная кнопка «назад» в шапке Telegram: на этом экране она
  // единственный привычный выход, своей стрелки в Mini App нет
  useEffect(() => {
    const back = getWebApp()?.BackButton;
    if (!back) return;
    back.onClick(leave);
    back.show();
    return () => {
      back.offClick(leave);
      back.hide();
    };
  }, [leave]);

  // Взведённое удаление само остывает: иначе случайный первый тап оставил бы
  // кнопку заряженной, и следующий — уже по другому поводу — стёр бы запись
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (missing) {
    return (
      <Screen>
        <h1 className="text-xl font-semibold">Запись не найдена</h1>
        <Hint>
          Возможно, её уже удалили — или ссылка ведёт на чужой дневник.
        </Hint>
        <div className="mt-auto pt-4">
          <Button onClick={() => router.replace('/')}>К дневнику</Button>
        </div>
      </Screen>
    );
  }

  if (error && !entry) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={load}>Попробовать снова</Button>
      </Screen>
    );
  }

  if (!entry) {
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  }

  const kept = entry.items.filter((i) => !removed.includes(i.id));
  const invalid = kept.some((i) => toGrams(grams[i.id] ?? '') === null);

  const totals = kept.reduce<Nutrition>(
    (sum, item) => {
      const n = preview(item, toGrams(grams[item.id] ?? '') ?? item.grams);
      return {
        kcal: sum.kcal + n.kcal,
        proteinG: round1(sum.proteinG + n.proteinG),
        fatG: round1(sum.fatG + n.fatG),
        carbsG: round1(sum.carbsG + n.carbsG),
      };
    },
    { kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 },
  );

  async function save() {
    if (!entry || invalid) return;
    setSaving(true);
    setError(null);

    try {
      const changed = kept
        .filter((item) => toGrams(grams[item.id] ?? '') !== item.grams)
        .map((item) => ({ id: item.id, grams: toGrams(grams[item.id] ?? '')! }));

      // Отправляем только изменившееся: PATCH с пустым телом — это лишний
      // проход по транзакции и лишняя строчка в updatedAt
      const body: Record<string, unknown> = {};
      if (mealType !== entry.mealType) body.mealType = mealType;
      // Правка из бота приходит на черновик — сохранение и есть подтверждение.
      // Отменённую запись то же действие возвращает в дневник.
      if (entry.status !== 'confirmed') body.status = 'confirmed';
      if (changed.length) body.items = changed;
      if (removed.length) body.removeItemIds = removed;

      if (Object.keys(body).length === 0) {
        leave();
        return;
      }

      await api(`/api/entries/${entry.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      haptic('success');
      router.replace('/');
    } catch (e) {
      haptic('error');
      setError(
        e instanceof ApiError
          ? e.message
          : 'Не удалось сохранить. Попробуйте ещё раз.',
      );
      setSaving(false);
    }
  }

  async function remove() {
    if (!entry) return;
    setSaving(true);
    setError(null);

    try {
      await api(`/api/entries/${entry.id}`, { method: 'DELETE' });
      haptic('success');
      router.replace('/');
    } catch (e) {
      haptic('error');
      setError(
        e instanceof ApiError
          ? e.message
          : 'Не удалось удалить. Попробуйте ещё раз.',
      );
      setSaving(false);
    }
  }

  const empty = kept.length === 0;

  // Удаление всегда идёт через второй тап — и с красной кнопки внизу,
  // и с главной, в которую она превращается, когда позиций не осталось
  const armDelete = () => (armed ? remove() : setArmed(true));

  const primaryLabel = empty
    ? armed
      ? 'Точно удалить запись?'
      : 'Удалить запись'
    : entry.status === 'confirmed'
      ? 'Сохранить'
      : entry.status === 'discarded'
        ? 'Вернуть в дневник'
        : 'Подтвердить';

  return (
    <Screen>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">
          {entry.status === 'pending' ? 'Проверьте разбор' : 'Запись'}
        </h1>
        <span className="text-sm text-[var(--tg-theme-hint-color)]">
          {formatWhen(entry.consumedAt)}
          {SOURCE_LABELS[entry.source] ? ` · ${SOURCE_LABELS[entry.source]}` : ''}
          {entry.status === 'discarded' ? ' · отменена' : ''}
        </span>
      </header>

      <Segmented value={mealType} options={MEAL_OPTIONS} onChange={setMealType} />

      <Card className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-[var(--tg-theme-hint-color)]">Итого</span>
          <span className="tabular text-2xl font-semibold">
            {totals.kcal} ккал
          </span>
        </div>
        <span className="tabular text-sm text-[var(--tg-theme-hint-color)]">
          Б {totals.proteinG} · Ж {totals.fatG} · У {totals.carbsG}
        </span>
      </Card>

      <section className="flex flex-col gap-2">
        {entry.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            value={grams[item.id] ?? ''}
            removed={removed.includes(item.id)}
            onChange={(next) =>
              setGrams((prev) => ({ ...prev, [item.id]: next }))
            }
            onRemove={() => {
              haptic('tap');
              setRemoved((prev) => [...prev, item.id]);
            }}
            onRestore={() => {
              haptic('tap');
              setRemoved((prev) => prev.filter((id) => id !== item.id));
            }}
          />
        ))}
      </section>

      {empty && (
        <Hint>
          Не осталось ни одной позиции — сохранять нечего, запись будет удалена
          целиком.
        </Hint>
      )}

      {entry.status === 'discarded' && !empty && (
        <Hint>
          Запись была отменена и в дневной итог не входит. Подтверждение вернёт
          её обратно.
        </Hint>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-4">
        {error && <ErrorNote>{error}</ErrorNote>}

        <Button
          onClick={empty ? armDelete : save}
          loading={saving}
          disabled={invalid}
        >
          {primaryLabel}
        </Button>

        <Button variant="ghost" onClick={leave}>
          Назад
        </Button>

        {!empty && (
          // Второй тап вместо системного диалога: showConfirm ведёт себя
          // по-разному на платформах Telegram, а промахнуться по кнопке
          // удаления в списке из трёх штук — обычное дело
          <Button variant="danger" onClick={armDelete} disabled={saving}>
            {armed ? 'Точно удалить запись?' : 'Удалить запись'}
          </Button>
        )}
      </div>
    </Screen>
  );
}

/* ──────────────────────────── Позиция ──────────────────────────────── */

function ItemRow({
  item,
  value,
  removed,
  onChange,
  onRemove,
  onRestore,
}: {
  item: Item;
  value: string;
  removed: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
  onRestore: () => void;
}) {
  if (removed) {
    return (
      <Card className="flex items-center justify-between gap-3">
        <span className="truncate text-[var(--tg-theme-hint-color)] line-through">
          {item.name}
        </span>
        <button
          type="button"
          onClick={onRestore}
          className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-[var(--tg-theme-link-color)]"
        >
          Вернуть
        </button>
      </Card>
    );
  }

  const grams = toGrams(value);
  const n = grams === null ? null : preview(item, grams);
  const known = hasNutrition(item);

  const note =
    grams === null
      ? { text: `Вес числом, от 0 до ${MAX_G} г`, bad: true }
      : !known
        ? { text: 'Продукта нет в справочнике — калорийность неизвестна', bad: false }
        : item.confidence !== null && item.confidence < LOW_CONFIDENCE
          ? { text: 'Модель не уверена в этой позиции — проверьте вес', bad: false }
          : item.estimatedGrams !== null &&
              Math.abs(item.estimatedGrams - grams) >= 1
            ? { text: `Модель оценила ${Math.round(item.estimatedGrams)} г`, bad: false }
            : null;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{item.name}</span>
        <span className="tabular shrink-0 text-sm">
          {known && n ? `${n.kcal} ккал` : 'нет данных'}
        </span>
      </div>

      {known && n && (
        <span className="tabular text-xs text-[var(--tg-theme-hint-color)]">
          Б {n.proteinG} · Ж {n.fatG} · У {n.carbsG}
        </span>
      )}

      <div className="flex items-center gap-2">
        <StepButton
          label="−"
          disabled={grams === null || grams <= 0}
          onClick={() => onChange(String(Math.max(0, (grams ?? 0) - STEP_G)))}
        />

        <span className="relative flex flex-1 items-center">
          <input
            value={value}
            inputMode="decimal"
            onChange={(e) => onChange(e.target.value)}
            aria-label={`Вес: ${item.name}`}
            className={`tabular min-h-12 w-full rounded-xl bg-[var(--tg-theme-bg-color)] px-4 pr-8 text-center text-base outline-none ${
              grams === null
                ? 'ring-2 ring-[var(--tg-theme-destructive-text-color)]'
                : ''
            }`}
          />
          <span className="pointer-events-none absolute right-3 text-sm text-[var(--tg-theme-hint-color)]">
            г
          </span>
        </span>

        <StepButton
          label="+"
          disabled={grams === null || grams >= MAX_G}
          onClick={() => onChange(String(Math.min(MAX_G, (grams ?? 0) + STEP_G)))}
        />

        <button
          type="button"
          onClick={onRemove}
          aria-label={`Убрать: ${item.name}`}
          className="min-h-12 w-10 shrink-0 rounded-xl text-lg text-[var(--tg-theme-hint-color)] active:opacity-60"
        >
          ✕
        </button>
      </div>

      {note && (
        <span
          className={`text-xs leading-snug ${
            note.bad
              ? 'text-[var(--tg-theme-destructive-text-color)]'
              : 'text-[var(--tg-theme-hint-color)]'
          }`}
        >
          {note.text}
        </span>
      )}
    </Card>
  );
}

function StepButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        haptic('select');
        onClick();
      }}
      // Те же 48 px, что и у остальных кнопок: пальцем в мелкую не попасть
      className="min-h-12 w-12 shrink-0 rounded-xl bg-[var(--tg-theme-bg-color)] text-xl font-medium active:opacity-70 disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/** «7 августа, 14:30» — время берётся из часового пояса телефона */
function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
