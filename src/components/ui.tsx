'use client';

import { type ReactNode, type InputHTMLAttributes } from 'react';
import { haptic } from '@/lib/telegram/client';

/* ──────────────────────────── Оболочка ─────────────────────────────── */

export function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-4 pt-4 pb-8">
      {children}
    </main>
  );
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-2xl bg-[var(--tg-theme-secondary-bg-color)] p-4 ${className}`}
    >
      {children}
    </section>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm leading-snug text-[var(--tg-theme-hint-color)]">
      {children}
    </p>
  );
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
      className={`min-h-12 w-full rounded-xl px-4 text-base font-medium transition-opacity active:opacity-70 disabled:opacity-40 ${styles}`}
    >
      {loading ? 'Секунду…' : children}
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
    <div className="flex gap-2">
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
            className={`min-h-12 flex-1 rounded-xl px-3 text-sm font-medium transition-colors ${
              active
                ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                : 'bg-[var(--tg-theme-secondary-bg-color)] text-[var(--tg-theme-text-color)]'
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
            className={`flex min-h-14 items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors ${
              active
                ? 'bg-[var(--tg-theme-button-color)] text-[var(--tg-theme-button-text-color)]'
                : 'bg-[var(--tg-theme-secondary-bg-color)]'
            }`}
          >
            <span
              className={`h-5 w-5 shrink-0 rounded-full border-2 ${
                active
                  ? 'border-current bg-current/30'
                  : 'border-[var(--tg-theme-hint-color)]'
              }`}
            />
            <span className="flex flex-col">
              <span className="text-base leading-tight">{option.label}</span>
              {option.hint && (
                <span
                  className={`text-xs leading-tight ${
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
      <span className="text-sm text-[var(--tg-theme-hint-color)]">{label}</span>
      <span className="relative flex items-center">
        <input
          {...input}
          // inputMode decimal вызывает цифровую клавиатуру с запятой:
          // рост и вес почти всегда дробные
          inputMode={input.inputMode ?? 'decimal'}
          className={`tabular min-h-12 w-full rounded-xl bg-[var(--tg-theme-secondary-bg-color)] px-4 text-base outline-none ${
            unit ? 'pr-14' : ''
          } ${error ? 'ring-2 ring-[var(--tg-theme-destructive-text-color)]' : ''}`}
        />
        {unit && (
          <span className="pointer-events-none absolute right-4 text-sm text-[var(--tg-theme-hint-color)]">
            {unit}
          </span>
        )}
      </span>
      {error ? (
        <span className="text-xs text-[var(--tg-theme-destructive-text-color)]">
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs text-[var(--tg-theme-hint-color)]">{hint}</span>
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
  const ratio = target > 0 ? Math.min(value / target, 1.5) : 0;
  const over = value > target;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-[var(--tg-theme-hint-color)]">{label}</span>
        <span className="tabular">
          {Math.round(value)}
          <span className="text-[var(--tg-theme-hint-color)]"> / {Math.round(target)} г</span>
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--tg-theme-bg-color)]">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${Math.min(ratio, 1) * 100}%`,
            backgroundColor: over ? 'var(--tg-theme-destructive-text-color)' : color,
          }}
        />
      </div>
    </div>
  );
}

/** Кольцо дневной нормы калорий */
export function CalorieRing({
  eaten,
  target,
}: {
  eaten: number;
  target: number;
}) {
  const size = 176;
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;

  const ratio = target > 0 ? eaten / target : 0;
  const over = ratio > 1;
  const left = target - eaten;

  return (
    <div className="relative flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-[var(--tg-theme-secondary-bg-color)]"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={
            over
              ? 'var(--tg-theme-destructive-text-color)'
              : 'var(--tg-theme-button-color)'
          }
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - Math.min(ratio, 1))}
          style={{ transition: 'stroke-dashoffset 0.4s ease-out' }}
        />
      </svg>

      <div className="absolute flex flex-col items-center">
        <span className="tabular text-4xl font-semibold leading-none">
          {Math.abs(Math.round(left))}
        </span>
        <span className="mt-1 text-sm text-[var(--tg-theme-hint-color)]">
          {left >= 0 ? 'осталось' : 'перебор'}
        </span>
        <span className="tabular mt-2 text-xs text-[var(--tg-theme-hint-color)]">
          {Math.round(eaten)} из {Math.round(target)} ккал
        </span>
      </div>
    </div>
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
    <Card className="border border-[var(--tg-theme-destructive-text-color)]/30">
      <p className="text-sm text-[var(--tg-theme-destructive-text-color)]">
        {children}
      </p>
    </Card>
  );
}
