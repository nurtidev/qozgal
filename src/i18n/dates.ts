'use client';

import { useLocale } from 'next-intl';

import { intlLocale, type Locale } from './provider';

/**
 * Форматирование дат на языке интерфейса.
 *
 * Даты вида ГГГГ-ММ-ДД разбираются вручную по частям, а не через
 * `new Date(iso)`: строка без времени считается полуночью по UTC, и в поясе
 * западнее Гринвича «7 августа» превратилось бы в «6 августа». В дневнике
 * питания съехавшая на день дата — это чужой день и чужие калории.
 */
export function useDates() {
  const locale = intlLocale(useLocale() as Locale);

  return {
    /** «7 августа» / «7 тамыз» */
    dayMonth(iso: string): string {
      const date = fromIsoDate(iso);
      if (!date) return iso;
      return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
      }).format(date);
    },

    /** «7 авг.» / «7 там.» — для тесных мест вроде подписей графика */
    dayMonthShort(iso: string): string {
      const date = fromIsoDate(iso);
      if (!date) return iso;
      return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
      }).format(date);
    },

    /** «7 августа в 14:30» — из метки времени, а не из даты */
    dayMonthTime(timestamp: string): string {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
    },
  };
}

function fromIsoDate(iso: string): Date | null {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
