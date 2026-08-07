import { createHmac } from 'node:crypto';
import type { Page } from '@playwright/test';

/**
 * Подмена моста Telegram Mini Apps для браузерных проверок.
 *
 * В настоящем клиенте Telegram объект window.Telegram.WebApp внедряется
 * самим приложением: оттуда берутся подписанные данные пользователя, тема
 * и управление кнопками. В обычном браузере его нет, поэтому страница без
 * заглушки просто не поднимется.
 *
 * Подпись здесь настоящая — тем же HMAC и тем же токеном бота, что
 * использует Telegram. Значит бэкенд проверяет её всерьёз, и тест
 * проходит ровно тот же путь авторизации, что и живой пользователь:
 * подделанный initData так же будет отвергнут.
 */

export interface StubUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: 'ru' | 'kk';
}

export const DEFAULT_USER: StubUser = {
  id: 999_000_001,
  first_name: 'Тест',
  username: 'test_user',
  language_code: 'ru',
};

/** Собирает и подписывает initData так же, как это делает Telegram */
export function signInitData(user: StubUser, botToken: string): string {
  const fields: Record<string, string> = {
    user: JSON.stringify(user),
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: 'AAE_playwright_e2e',
  };

  const dataCheckString = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('\n');

  // Ключ — HMAC("WebAppData", токен), а не сам токен: у Login Widget
  // схема обратная, и перепутанные аргументы дадут неверную подпись
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return new URLSearchParams({ ...fields, hash }).toString();
}

export type ColorScheme = 'light' | 'dark';

/** Палитры Telegram — проверяем вёрстку в обеих */
const THEMES: Record<ColorScheme, Record<string, string>> = {
  light: {
    bg_color: '#ffffff',
    text_color: '#000000',
    hint_color: '#707579',
    link_color: '#3390ec',
    button_color: '#3390ec',
    button_text_color: '#ffffff',
    secondary_bg_color: '#f4f4f5',
  },
  dark: {
    bg_color: '#17212b',
    text_color: '#f5f5f5',
    hint_color: '#708499',
    link_color: '#6ab3f3',
    button_color: '#5288c1',
    button_text_color: '#ffffff',
    secondary_bg_color: '#232e3c',
  },
};

export interface StubOptions {
  user?: StubUser;
  colorScheme?: ColorScheme;
  botToken?: string;
}

/**
 * Собирает текст внедряемого скрипта.
 *
 * Именно текстом, а не функцией: tsx компилирует файл через esbuild, и тот
 * при сериализации функции подставляет в неё ссылку на свой вспомогательный
 * помощник __name. В браузере такой переменной нет, и страница получает
 * ошибку «Can't find variable: __name», которой в приложении не было.
 * Обвязка, выдумывающая баги, хуже отсутствующей обвязки — поэтому строка.
 */
function buildStubScript(
  initData: string,
  user: StubUser,
  colorScheme: ColorScheme,
  themeParams: Record<string, string>,
): string {
  return `
(function () {
  var noop = function () {};
  var button = {
    text: '', isVisible: false,
    show: noop, hide: noop, enable: noop, disable: noop, setText: noop,
    onClick: noop, offClick: noop, showProgress: noop, hideProgress: noop
  };
  var theme = ${JSON.stringify(themeParams)};

  window.Telegram = {
    WebApp: {
      initData: ${JSON.stringify(initData)},
      initDataUnsafe: {
        user: ${JSON.stringify(user)},
        auth_date: Math.floor(Date.now() / 1000),
        query_id: 'AAE_playwright_e2e'
      },
      version: '8.0',
      platform: 'ios',
      colorScheme: ${JSON.stringify(colorScheme)},
      themeParams: theme,
      isExpanded: true,
      viewportHeight: 800,
      viewportStableHeight: 800,
      headerColor: theme.bg_color,
      backgroundColor: theme.bg_color,
      isClosingConfirmationEnabled: false,
      ready: noop, expand: noop, close: noop,
      onEvent: noop, offEvent: noop, sendData: noop, openLink: noop,
      showAlert: noop, showConfirm: noop,
      MainButton: Object.assign({}, button),
      SecondaryButton: Object.assign({}, button),
      BackButton: { isVisible: false, show: noop, hide: noop, onClick: noop, offClick: noop },
      HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
      CloudStorage: { getItem: noop, setItem: noop, removeItem: noop }
    }
  };

  // Telegram задаёт палитру CSS-переменными — от них зависит вёрстка.
  // Скрипт выполняется до разбора документа, поэтому documentElement ещё
  // может отсутствовать: сам объект Telegram нужен странице сразу, а вот
  // переменные ставим, как только появится корневой элемент.
  function applyTheme() {
    var root = document.documentElement;
    if (!root) return;
    Object.keys(theme).forEach(function (key) {
      root.style.setProperty('--tg-theme-' + key.replace(/_/g, '-'), theme[key]);
    });
    root.style.setProperty('color-scheme', ${JSON.stringify(colorScheme)});
  }

  if (document.documentElement) {
    applyTheme();
  } else {
    document.addEventListener('DOMContentLoaded', applyTheme);
  }
})();
`;
}

/**
 * Внедряет мост до загрузки страницы. Через addInitScript, а не evaluate:
 * код Mini App читает window.Telegram сразу при старте, и заглушка,
 * поставленная после загрузки, окажется бесполезной.
 */
export async function installTelegramStub(
  page: Page,
  options: StubOptions = {},
): Promise<string> {
  const {
    user = DEFAULT_USER,
    colorScheme = 'light',
    botToken = process.env.TELEGRAM_BOT_TOKEN,
  } = options;

  if (!botToken) {
    throw new Error('Для подписи initData нужен TELEGRAM_BOT_TOKEN');
  }

  const initData = signInitData(user, botToken);

  await page.addInitScript({
    content: buildStubScript(initData, user, colorScheme, THEMES[colorScheme]),
  });

  return initData;
}

/** Размер экрана телефона: Mini App почти всегда открывают с него */
export const PHONE_VIEWPORT = { width: 390, height: 844 };
