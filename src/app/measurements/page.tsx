'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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
import { calcLeanBodyMass } from '@/lib/health/composition';

interface Measurement {
  measuredOn: string;
  neckCm: number;
  waistCm: number;
  hipCm: number | null;
  chestCm: number | null;
  bicepsCm: number | null;
  thighCm: number | null;
  calfCm: number | null;
  bodyFatPct: number | null;
}

interface Me {
  needsOnboarding: boolean;
  profile?: { sex: 'male' | 'female'; heightCm: number };
  weight: { kg: number; loggedOn: string } | null;
}

/** Границы те же, что проверяет API: расходиться им нельзя */
const LIMITS = {
  neckCm: [20, 80],
  waistCm: [40, 200],
  hipCm: [50, 200],
  chestCm: [50, 200],
  bicepsCm: [15, 80],
  thighCm: [30, 120],
  calfCm: [20, 80],
} as const;

type FieldName = keyof typeof LIMITS;

const EXTRA: { name: FieldName; label: string; hint: string }[] = [
  { name: 'chestCm', label: 'Грудь', hint: 'По самой широкой части, руки опущены' },
  { name: 'bicepsCm', label: 'Бицепс', hint: 'Напряжённая рука, самое широкое место' },
  { name: 'thighCm', label: 'Бедро', hint: 'На ладонь ниже паховой складки' },
  { name: 'calfCm', label: 'Икра', hint: 'В самом широком месте' },
];

export default function MeasurementsPage() {
  const router = useRouter();
  useTelegramApp();
  useTelegramBack(useCallback(() => router.replace('/'), [router]));

  const [me, setMe] = useState<Me | null>(null);
  const [history, setHistory] = useState<Measurement[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [showExtra, setShowExtra] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const [profile, list] = await Promise.all([
        api<Me>('/api/me'),
        api<{ measurements: Measurement[] }>('/api/measurements'),
      ]);
      if (profile.needsOnboarding) {
        router.replace('/onboarding');
        return;
      }
      setMe(profile);
      setHistory(list.measurements);

      // Поля заполняем прошлым замером: обхваты меняются на сантиметры,
      // и набирать семь чисел заново — верный способ забросить замеры
      const last = list.measurements[0];
      if (last) {
        setValues((prev) =>
          Object.keys(prev).length
            ? prev
            : Object.fromEntries(
                (Object.keys(LIMITS) as FieldName[])
                  .filter((k) => last[k] != null)
                  .map((k) => [k, String(last[k])]),
              ),
        );
        if (last.chestCm ?? last.bicepsCm ?? last.thighCm ?? last.calfCm) {
          setShowExtra(true);
        }
      }
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : 'Не удалось загрузить замеры. Проверьте связь.',
      );
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [saved]);

  function num(name: FieldName): number | null {
    const text = (values[name] ?? '').replace(',', '.').trim();
    if (!text) return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : NaN;
  }

  async function save() {
    if (!me?.profile) return;

    const body: Record<string, number | null> = {};
    const bad: Record<string, string> = {};

    for (const name of Object.keys(LIMITS) as FieldName[]) {
      const value = num(name);
      if (value === null) {
        body[name] = null;
        continue;
      }
      const [min, max] = LIMITS[name];
      if (Number.isNaN(value) || value < min || value > max) {
        bad[name] = `От ${min} до ${max} см`;
        continue;
      }
      body[name] = value;
    }

    // Шея и талия входят в формулу процента жира, у женщин ещё и бёдра —
    // без них считать нечего. Проверка «не задано» не должна затирать
    // сообщение о диапазоне: 300 см на талии — это опечатка, а не пропуск
    if (body.neckCm == null && !bad.neckCm) bad.neckCm = 'Нужен обхват шеи';
    if (body.waistCm == null && !bad.waistCm) bad.waistCm = 'Нужен обхват талии';
    if (me.profile.sex === 'female' && body.hipCm == null && !bad.hipCm) {
      bad.hipCm = 'Для женщин обхват бёдер входит в формулу';
    }

    if (Object.keys(bad).length) {
      setFields(bad);
      haptic('error');
      return;
    }

    setSaving(true);
    setError(null);
    setFields({});

    try {
      const result = await api<{ bodyFatPct: number | null; bodyFatNote: string | null }>(
        '/api/measurements',
        { method: 'POST', body: JSON.stringify(body) },
      );
      haptic(result.bodyFatPct === null ? 'error' : 'success');
      setSaved(true);
      setNote(result.bodyFatNote);
      await load();
    } catch (e) {
      haptic('error');
      if (e instanceof ApiError) {
        setError(e.message);
        setFields(e.fields ?? {});
      } else {
        setError('Не удалось сохранить. Попробуйте ещё раз.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (error && !history) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={load}>Попробовать снова</Button>
      </Screen>
    );
  }

  if (!me || !history) {
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  }

  const [last, previous] = history;
  const female = me.profile?.sex === 'female';
  const weightKg = me.weight?.kg ?? null;

  const lean =
    last?.bodyFatPct != null && weightKg !== null
      ? calcLeanBodyMass(weightKg, last.bodyFatPct)
      : null;

  const fatChange =
    last?.bodyFatPct != null && previous?.bodyFatPct != null
      ? Math.round((last.bodyFatPct - previous.bodyFatPct) * 10) / 10
      : null;
  const waistChange =
    last && previous ? Math.round((last.waistCm - previous.waistCm) * 10) / 10 : null;

  return (
    <Screen>
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Замеры тела</h1>
        {last && (
          <span className="text-sm text-[var(--tg-theme-hint-color)]">
            {formatDate(last.measuredOn)}
          </span>
        )}
      </header>

      {last && (
        <Card className="flex flex-col gap-1">
          {last.bodyFatPct != null ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="tabular text-4xl font-semibold">
                  {last.bodyFatPct}%
                </span>
                <span className="text-sm text-[var(--tg-theme-hint-color)]">
                  жира
                </span>
              </div>
              {lean !== null && (
                <span className="tabular text-sm text-[var(--tg-theme-hint-color)]">
                  Сухая масса {lean} кг при весе {weightKg} кг
                </span>
              )}
            </>
          ) : (
            <Hint>
              Процент жира по прошлым обхватам не рассчитан — формула их не
              приняла.
            </Hint>
          )}

          {previous && (fatChange !== null || waistChange !== null) && (
            <span className="tabular mt-1 text-sm">
              {[
                fatChange !== null &&
                  `жир ${signed(fatChange)}%`,
                waistChange !== null && `талия ${signed(waistChange)} см`,
              ]
                .filter(Boolean)
                .join(' · ')}{' '}
              <span className="text-[var(--tg-theme-hint-color)]">
                с {formatDate(previous.measuredOn)}
              </span>
            </span>
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <Field
          label="Шея"
          unit="см"
          value={values.neckCm ?? ''}
          error={fields.neckCm}
          placeholder="38"
          onChange={(e) => setValues({ ...values, neckCm: e.target.value })}
          hint="Под кадыком, сантиметр лежит горизонтально"
        />
        <Field
          label="Талия"
          unit="см"
          value={values.waistCm ?? ''}
          error={fields.waistCm}
          placeholder="85"
          onChange={(e) => setValues({ ...values, waistCm: e.target.value })}
          hint="На уровне пупка, живот не втягивать"
        />
        <Field
          label={female ? 'Бёдра' : 'Бёдра (не обязательно)'}
          unit="см"
          value={values.hipCm ?? ''}
          error={fields.hipCm}
          placeholder="95"
          onChange={(e) => setValues({ ...values, hipCm: e.target.value })}
          hint="По самой широкой части ягодиц"
        />

        {showExtra ? (
          EXTRA.map((f) => (
            <Field
              key={f.name}
              label={f.label}
              unit="см"
              value={values[f.name] ?? ''}
              error={fields[f.name]}
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              // Подсказку по технике держим, пока поле пустое: она нужна
              // на первом замере, а на повторных четыре строки инструкций
              // превращают форму в стену текста
              hint={values[f.name] ? undefined : f.hint}
            />
          ))
        ) : (
          <Button variant="ghost" onClick={() => setShowExtra(true)}>
            Добавить грудь, бицепс, бедро и икру
          </Button>
        )}

        <Button onClick={save} loading={saving}>
          {saved ? 'Сохранено' : 'Сохранить замеры'}
        </Button>
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}
      {note && <ErrorNote>{note}</ErrorNote>}

      <Hint>
        Процент жира считается по методу US Navy: он даёт ±3–4% против
        лабораторного взвешивания, поэтому смотреть стоит на изменение, а не на
        саму цифру. Мерьте утром, до еды, тем же сантиметром и в тех же местах —
        иначе разница между замерами будет про технику, а не про тело.
      </Hint>

      {history.length > 1 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-[var(--tg-theme-hint-color)]">
            История
          </h2>
          {history.slice(0, 10).map((m) => (
            <Card key={m.measuredOn} className="flex items-baseline justify-between">
              <span className="text-sm">{formatDate(m.measuredOn)}</span>
              <span className="tabular text-sm text-[var(--tg-theme-hint-color)]">
                {m.bodyFatPct != null ? `${m.bodyFatPct}% жира · ` : ''}
                талия {m.waistCm} см
              </span>
            </Card>
          ))}
        </section>
      )}
    </Screen>
  );
}

/** Знак у изменения ставим всегда: «0.4» и «−0.4» иначе не различить */
function signed(value: number): string {
  if (value === 0) return '±0';
  return `${value > 0 ? '+' : '−'}${Math.abs(value)}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(y, m - 1, d));
}
