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
  RadioList,
  Segmented,
  Spinner,
  ErrorNote,
} from '@/components/ui';
import { useDates } from '@/i18n/dates';
import type { BodyArea, InjurySeverity } from '@/lib/health/injury';

interface Injury {
  id: string;
  area: BodyArea;
  severity: InjurySeverity;
  startedOn: string;
  resolvedOn: string | null;
  note: string | null;
}

const AREAS: BodyArea[] = [
  'lower_back',
  'neck',
  'shoulder',
  'elbow',
  'wrist',
  'hip',
  'knee',
  'ankle',
];

const SEVERITIES: InjurySeverity[] = ['watch', 'pain', 'medical'];

/**
 * Травмы и ограничения.
 *
 * Экран не лечит и не ставит диагнозов. Он нужен, чтобы при выборе
 * упражнения приложение могло сказать: это движение нагружает то место,
 * которое у вас болит. Дальше решает человек — и его врач.
 */
export default function InjuriesPage() {
  const router = useRouter();
  const t = useTranslations('injuries');
  const tc = useTranslations('common');
  const dates = useDates();

  useTelegramApp();
  useTelegramBack(useCallback(() => router.replace('/'), [router]));

  const [injuries, setInjuries] = useState<Injury[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [area, setArea] = useState<BodyArea | null>(null);
  const [severity, setSeverity] = useState<InjurySeverity>('pain');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<{ injuries: Injury[] }>('/api/injuries?all=1');
      setInjuries(data.injuries);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('loadFailed'));
    }
  }, [tc]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!area) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/injuries', {
        method: 'POST',
        body: JSON.stringify({ area, severity }),
      });
      haptic('success');
      setAdding(false);
      setArea(null);
      setSeverity('pain');
      await load();
    } catch (e) {
      haptic('error');
      setError(e instanceof ApiError ? e.message : tc('saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: string) {
    haptic('tap');
    try {
      await api(`/api/injuries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolve: true }),
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('saveFailed'));
    }
  }

  async function reopen(id: string) {
    haptic('tap');
    try {
      await api(`/api/injuries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolvedOn: null }),
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : tc('saveFailed'));
    }
  }

  useMainButton({
    text: adding ? t('save') : t('add'),
    onClick: () => (adding ? add() : setAdding(true)),
    visible: injuries !== null,
    disabled: adding && !area,
    loading: busy,
  });

  if (error && !injuries) {
    return (
      <Screen>
        <ErrorNote>{error}</ErrorNote>
        <Button onClick={load}>{tc('retry')}</Button>
      </Screen>
    );
  }

  if (!injuries) {
    return (
      <Screen>
        <Spinner />
      </Screen>
    );
  }

  const active = injuries.filter((i) => !i.resolvedOn);
  const closed = injuries.filter((i) => i.resolvedOn);

  return (
    <Screen>
      <h1 className="text-xl font-semibold">{t('title')}</h1>

      {/* Оговорка стоит выше списка, а не мелким шрифтом внизу: человек
          должен прочитать её до того, как решит, что приложение знает,
          что ему можно */}
      <Card>
        <Hint>{t('disclaimer')}</Hint>
      </Card>

      {active.length === 0 && !adding && (
        <Card>
          <Hint>{t('empty')}</Hint>
        </Card>
      )}

      {active.length > 0 && (
        <section className="flex flex-col gap-2">
          {active.map((injury) => (
            <Card key={injury.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{t(`areas.${injury.area}`)}</span>
                <span className="text-sm text-[var(--tg-theme-hint-color)]">
                  {t(`severities.${injury.severity}`)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs text-[var(--tg-theme-hint-color)]">
                  {t('since', { date: dates.dayMonth(injury.startedOn) })}
                </span>
                <button
                  type="button"
                  onClick={() => resolve(injury.id)}
                  className="text-sm text-[var(--tg-theme-link-color)]"
                >
                  {t('resolve')}
                </button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {adding ? (
        <Card className="fade-in flex flex-col gap-4">
          <span className="text-sm text-[var(--tg-theme-hint-color)]">
            {t('whereHurts')}
          </span>
          <RadioList
            value={area}
            onChange={setArea}
            options={AREAS.map((value) => ({
              value,
              label: t(`areas.${value}`),
            }))}
          />

          <span className="text-sm text-[var(--tg-theme-hint-color)]">
            {t('howBad')}
          </span>
          <Segmented
            value={severity}
            onChange={setSeverity}
            options={SEVERITIES.map((value) => ({
              value,
              label: t(`severities.${value}`),
            }))}
          />

          <Button variant="ghost" onClick={() => setAdding(false)}>
            {tc('back')}
          </Button>
        </Card>
      ) : null}

      {error && <ErrorNote>{error}</ErrorNote>}

      {closed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-[var(--tg-theme-hint-color)]">
            {t('closed')}
          </h2>
          {closed.map((injury) => (
            <Card key={injury.id} className="flex items-baseline justify-between gap-2">
              <span className="text-sm text-[var(--tg-theme-hint-color)]">
                {t(`areas.${injury.area}`)} ·{' '}
                {t('until', { date: dates.dayMonth(injury.resolvedOn!) })}
              </span>
              <button
                type="button"
                onClick={() => reopen(injury.id)}
                className="shrink-0 text-sm text-[var(--tg-theme-link-color)]"
              >
                {t('reopen')}
              </button>
            </Card>
          ))}
        </section>
      )}
    </Screen>
  );
}
