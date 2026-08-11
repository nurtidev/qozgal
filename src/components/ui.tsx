'use client';

import {
  useEffect,
  useState,
  type ReactNode,
  type InputHTMLAttributes,
} from 'react';
import { useTranslations } from 'next-intl';

import { haptic } from '@/lib/telegram/client';

/**
 * Общие элементы интерфейса.
 *
 * Правило раздела: холст — телеграмный, содержимое — наше. Фон, текст
 * и цвет кнопки всегда приходят из темы клиента, поэтому приложение
 * остаётся своим в любой теме, включая пользовательские. Характер даёт
 * не палитра, а обращение с данными: крупные табличные числа, мелкие
 * подписи заглавными, волосяные разделители вместо частокола карточек
 * и единый шаг сетки.
 */

/* ──────────────────────────── Оболочка ─────────────────────────────── */

export function Screen({ children }: { children: ReactNode }) {
  return (
    // Запас снизу под кнопку Telegram: она рисуется поверх окна, и без
    // отступа последний элемент экрана оказывался бы под ней
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 px-4 pt-3 pb-24">
      {children}
    </main>
  );
}

/** Заголовок экрана; справа — необязательное действие или значение */
export function ScreenTitle({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex items-baseline justify-between gap-3">
      <h1 className="t-title">{children}</h1>
      {aside}
    </header>
  );
}

/**
 * Раздел с микроподписью.
 *
 * Подпись набрана заглавными в разрядку — так она читается как служебная
 * пометка на приборе и не спорит за внимание с числами под ней.
 */
export function Section({
  label,
  children,
  aside,
}: {
  label?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      {(label || aside) && (
        <div className="flex items-baseline justify-between gap-2 px-1">
          {label ? <h2 className="t-label">{label}</h2> : <span />}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({
  children,
  className = '',
  tone = 'surface',
}: {
  children: ReactNode;
  className?: string;
  /** danger — рамка предупреждения; plain — без заливки, только разделители */
  tone?: 'surface' | 'plain' | 'danger';
}) {
  const tones = {
    surface: 'bg-[var(--tg-theme-secondary-bg-color)]',
    plain: '',
    danger:
      'bg-[var(--tg-theme-secondary-bg-color)] ring-1 ring-[var(--tg-theme-destructive-text-color)]/35',
  }[tone];

  return (
    <section
      className={`rounded-[var(--radius-card)] p-4 ${tones} ${className}`}
    >
      {children}
    </section>
  );
}

/** Волосяная линия между строками списка */
export function Divider({ inset = false }: { inset?: boolean }) {
  return <div className={`hairline h-px ${inset ? 'ml-4' : ''}`} />;
}

/**
 * Строка списка: слева подпись и пояснение, справа значение.
 *
 * Один компонент на все переходы и показания приложения — иначе каждый
 * экран изобретает свою строку, и они расходятся по высоте на пару
 * пикселей, что видно, когда экраны стоят рядом.
 */
export function Row({
  title,
  caption,
  value,
  valueTone = 'normal',
  onClick,
  chevron,
  trailing,
}: {
  title: ReactNode;
  caption?: ReactNode;
  value?: ReactNode;
  valueTone?: 'normal' | 'hint' | 'danger';
  onClick?: () => void;
  chevron?: boolean;
  trailing?: ReactNode;
}) {
  const valueClass = {
    normal: '',
    hint: 'text-[var(--tg-theme-hint-color)]',
    danger: 'text-[var(--tg-theme-destructive-text-color)]',
  }[valueTone];

  const body = (
    <div className="flex min-h-11 w-full items-center justify-between gap-3 py-1.5 text-left">
      <span className="flex min-w-0 flex-col">
        <span className="t-body truncate">{title}</span>
        {caption && <span className="t-caption truncate">{caption}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {value !== undefined && (
          <span className={`n-m ${valueClass}`}>{value}</span>
        )}
        {trailing}
        {chevron && (
          <span
            aria-hidden
            className="text-[var(--tg-theme-hint-color)] opacity-60"
          >
            ›
          </span>
        )}
      </span>
    </div>
  );

  if (!onClick) return body;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full transition-opacity active:opacity-60"
    >
      {body}
    </button>
  );
}

/** Капсула-пометка: статус записи, ограничение, очередь в программе */
export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'danger';
}) {
  const tones = {
    neutral:
      'bg-[var(--tg-theme-hint-color)]/15 text-[var(--tg-theme-hint-color)]',
    accent:
      'bg-[var(--tg-theme-button-color)]/15 text-[var(--tg-theme-link-color)]',
    danger:
      'bg-[var(--tg-theme-destructive-text-color)]/12 text-[var(--tg-theme-destructive-text-color)]',
  }[tone];

  return (
    <span
      className={`rounded-[var(--radius-chip)] px-2 py-0.5 text-[11px] leading-4 font-medium ${tones}`}
    >
      {children}
    </span>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="t-caption px-1 leading-snug">{children}</p>;
}

/* ──────────────────────────── Управление ───────────────────────────── */

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  loading,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
}) {
  const t = useTranslations('common');

  const styles = {
    primary:
      'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]',
    ghost:
      'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]',
    danger: 'bg-transparent text-[var(--tg-theme-destructive-text-color)]',
  }[variant];

  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={() => {
        haptic('tap');
        onClick?.();
      }}
      // Минимум 48 px по высоте: пальцем в мелкую кнопку не попасть
      className={`min-h-12 w-full rounded-[var(--radius-control)] px-4 text-[15px] font-medium transition-[opacity,transform] active:scale-[0.99] active:opacity-70 disabled:opacity-40 ${styles}`}
    >
      {loading ? t('saving') : children}
    </button>
  );
}

/** Переключатель из нескольких взаимоисключающих вариантов */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    // Общая подложка с рамкой: переключатель читается как один орган
    // управления, а не как ряд слов. Рамка обязательна — подложка совпадает
    // по цвету то с фоном экрана, то с карточкой, и без неё переключатель
    // с невыбранным значением выглядел просто строкой текста
    <div className="flex gap-1 rounded-[var(--radius-control)] border border-[var(--tg-theme-hint-color)]/20 bg-[var(--tg-theme-bg-color)] p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              haptic('select');
              onChange(option.value);
            }}
            className={`min-h-10 flex-1 rounded-[10px] px-3 text-[14px] font-medium transition-colors ${
              active
                ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                : 'text-[var(--tg-theme-text-color)]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Список вариантов в столбик — когда подписи длиннее пары слов */
export function RadioList<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | null;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              haptic('select');
              onChange(option.value);
            }}
            className={`flex min-h-14 items-center gap-3 rounded-[var(--radius-control)] px-4 py-3 text-left transition-colors ${
              active
                ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                : 'bg-[var(--tg-theme-secondary-bg-color)]'
            }`}
          >
            <span
              className={`h-[18px] w-[18px] shrink-0 rounded-full border-2 ${
                active
                  ? 'border-current bg-current/30'
                  : 'border-[var(--tg-theme-hint-color)] opacity-60'
              }`}
            />
            <span className="flex flex-col">
              <span className="text-[15px] leading-tight">{option.label}</span>
              {option.hint && (
                <span
                  className={`mt-0.5 text-[12px] leading-tight ${
                    active ? 'opacity-80' : 'text-[var(--tg-theme-hint-color)]'
                  }`}
                >
                  {option.hint}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  unit?: string;
  error?: string;
  hint?: string;
}

export function Field({ label, unit, error, hint, ...input }: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="t-label">{label}</span>
      <span className="relative flex items-center">
        <input
          {...input}
          // inputMode decimal вызывает цифровую клавиатуру с запятой:
          // рост и вес почти всегда дробные
          inputMode={input.inputMode ?? 'decimal'}
          // Фон основной, а не карточный, плюс волосяная рамка: поля стоят
          // и на голом экране, и внутри карточки, а карточка залита ровно
          // тем же серым — без рамки поле в ней переставало читаться
          // как поле и выглядело просто строкой текста
          className={`n-m min-h-12 w-full rounded-[var(--radius-control)] border border-[var(--tg-theme-hint-color)]/20 bg-[var(--tg-theme-bg-color)] px-4 outline-none ${
            unit ? 'pr-14' : ''
          } ${error ? 'border-transparent ring-2 ring-[var(--tg-theme-destructive-text-color)]' : ''}`}
        />
        {unit && (
          <span className="t-caption pointer-events-none absolute right-4">
            {unit}
          </span>
        )}
      </span>
      {error ? (
        <span className="text-[12px] leading-4 text-[var(--tg-theme-destructive-text-color)]">
          {error}
        </span>
      ) : hint ? (
        <span className="t-caption">{hint}</span>
      ) : null}
    </label>
  );
}

/* ─────────────────────────── Индикаторы ────────────────────────────── */

/** Полоса выполнения нормы по одному нутриенту */
export function MacroBar({
  label,
  value,
  target,
  color,
}: {
  label: string;
  value: number;
  target: number;
  color: string;
}) {
  const t = useTranslations('common');
  const ratio = target > 0 ? Math.min(value / target, 1) : 0;
  const over = value > target;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="t-label">{label}</span>
        <span className="tabular text-[13px] leading-4">
          {Math.round(value)}
          <span className="text-[var(--tg-theme-hint-color)]">
            {' '}
            / {Math.round(target)} {t('g')}
          </span>
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-[var(--tg-theme-hint-color)]/15">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${ratio * 100}%`,
            backgroundColor: over
              ? 'var(--tg-theme-destructive-text-color)'
              : color,
          }}
        />
      </div>
    </div>
  );
}

/**
 * Дуга дня.
 *
 * Показывает одно: сколько от дневной нормы уже съедено. Была попытка
 * разбить её на сегменты по приёмам пищи — чтобы по форме читалась
 * структура дня, — но на экране это выглядело браком отрисовки, а не
 * замыслом: сначала из-за разной прозрачности соседних кусков, потом
 * из-за скруглённых концов, которые наплывали друг на друга на стыках.
 * Приём, который приходится объяснять, на приборной панели не работает,
 * поэтому дуга сплошная. Структура дня видна в списке под ней.
 *
 * Перебор рисуется отдельной дугой поверх замкнутого кольца — так видно
 * не только то, что норма превышена, но и насколько.
 */
export function DayArc({ eaten, target }: { eaten: number; target: number }) {
  const t = useTranslations('ring');

  const size = 184;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  // Дуга вырастает из нуля после первого кадра: иначе рост нечему
  // анимировать, и число в центре выглядит просто надписью рядом с кольцом
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const timer = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(timer);
  }, []);

  const left = target - eaten;
  const over = left < 0;
  const ratio = target > 0 ? Math.min(eaten / target, 1) : 0;
  const overRatio = target > 0 ? Math.min(-left / target, 1) : 0;

  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-[var(--tg-theme-hint-color)] opacity-15"
        />

        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke="var(--tg-theme-button-color)"
          className="arc-seg"
          strokeDasharray={`${grown ? ratio * circumference : 0} ${circumference}`}
        />

        {over && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            stroke="var(--tg-theme-destructive-text-color)"
            className="arc-seg"
            strokeDasharray={`${grown ? overRatio * circumference : 0} ${circumference}`}
          />
        )}
      </svg>

      <div className="absolute flex flex-col items-center">
        <span className="n-xl">{Math.abs(Math.round(left))}</span>
        <span className="t-label mt-1.5">{over ? t('over') : t('left')}</span>
        <span className="t-caption tabular mt-2">
          {t('outOf', { eaten: Math.round(eaten), target: Math.round(target) })}
        </span>
      </div>
    </div>
  );
}

/**
 * Каркас содержимого на время загрузки.
 *
 * Вместо крутящегося кружка: он говорит «что-то происходит», а каркас —
 * «сейчас здесь будет вот это». Разница заметна на мобильной сети, где
 * ожидание длится секунду-две, и экран не должен выглядеть сломанным.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  // Скругление задаёт вызывающий: кольцо калорий круглое, карточки — нет,
  // а в базовом классе оно перебивало бы переданное
  return (
    <div
      className={`skeleton bg-[var(--tg-theme-secondary-bg-color)] ${className}`}
    />
  );
}

/** Типовой каркас: заголовок и несколько карточек */
export function ScreenSkeleton({
  rows = 3,
  ring = false,
}: {
  rows?: number;
  ring?: boolean;
}) {
  return (
    <>
      <Skeleton className="h-7 w-40 rounded-lg" />
      {ring && (
        <div className="flex justify-center py-2">
          <Skeleton className="h-46 w-46 rounded-full" />
        </div>
      )}
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton
          key={i}
          className="h-20 w-full rounded-[var(--radius-card)]"
        />
      ))}
    </>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--tg-theme-hint-color)] border-t-transparent" />
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <Card tone="danger">
      <p className="t-body text-[var(--tg-theme-destructive-text-color)]">
        {children}
      </p>
    </Card>
  );
}
