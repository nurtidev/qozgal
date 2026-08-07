'use client';

import { useEffect } from 'react';

/**
 * Клиентская сторона моста Telegram.
 *
 * Используется нативный window.Telegram.WebApp, а не SDK-обёртка: набор
 * нужных нам возможностей невелик, а лишняя зависимость в своё время
 * притащила уязвимость и потребовала override. Заглушка в браузерных
 * тестах повторяет ровно этот интерфейс.
 */

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
  };
  colorScheme?: 'light' | 'dark';
  themeParams?: Record<string, string>;
  platform?: string;
  ready(): void;
  expand(): void;
  close(): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
    selectionChanged(): void;
  };
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { Telegram?: { WebApp?: TelegramWebApp } };
  return w.Telegram?.WebApp ?? null;
}

/**
 * Переносит палитру Telegram в CSS-переменные.
 *
 * Без этого вёрстка не знает цветов клиента, и у человека с тёмной темой
 * открывается белый экран. Значения приходят snake_case, в CSS удобнее
 * дефисы, поэтому имена преобразуются.
 */
export function applyTheme(app: TelegramWebApp): void {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(app.themeParams ?? {})) {
    root.style.setProperty(`--tg-theme-${key.replace(/_/g, '-')}`, value);
  }
  if (app.colorScheme) {
    root.style.setProperty('color-scheme', app.colorScheme);
    root.dataset.theme = app.colorScheme;
  }
}

/* ──────────────────────────── Хуки экрана ──────────────────────────── */

/**
 * Стартовая последовательность Mini App: сообщить клиенту, что страница
 * готова, развернуть окно на весь экран и перенести палитру в CSS.
 * Нужна каждому экрану, поэтому вынесена сюда — забытый вызов означает
 * свёрнутое окно и белый фон в тёмной теме.
 */
export function useTelegramApp(): void {
  useEffect(() => {
    const app = getWebApp();
    if (!app) return;
    app.ready();
    app.expand();
    applyTheme(app);
  }, []);
}

/**
 * Системная кнопка «назад» в шапке Telegram.
 *
 * На внутренних экранах она единственный привычный выход: своей стрелки
 * в Mini App нет, а свайп назад работает не на всех платформах.
 */
export function useTelegramBack(onBack: () => void): void {
  useEffect(() => {
    const back = getWebApp()?.BackButton;
    if (!back) return;
    back.onClick(onBack);
    back.show();
    return () => {
      back.offClick(onBack);
      back.hide();
    };
  }, [onBack]);
}

/* ─────────────────────────── Запросы к API ─────────────────────────── */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Обёртка над fetch, подставляющая подпись Telegram.
 *
 * Заголовок формируется на каждый запрос из текущего initData: он живёт
 * ограниченное время, и закешированное значение однажды перестанет
 * проходить проверку на сервере.
 */
export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const app = getWebApp();
  if (!app?.initData) {
    throw new ApiError('Приложение открыто вне Telegram', 401);
  }

  const response = await fetch(path, {
    ...init,
    headers: {
      authorization: `tma ${app.initData}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new ApiError(
      body.error ?? 'Не удалось выполнить запрос',
      response.status,
      body.fields,
    );
  }

  return body as T;
}

/** Тактильный отклик — в Telegram он ощутимо оживляет интерфейс */
export function haptic(
  kind: 'tap' | 'success' | 'error' | 'select' = 'tap',
): void {
  const h = getWebApp()?.HapticFeedback;
  if (!h) return;
  if (kind === 'tap') h.impactOccurred('light');
  else if (kind === 'select') h.selectionChanged();
  else h.notificationOccurred(kind === 'success' ? 'success' : 'error');
}
