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
  var theme = ${JSON.stringify(themeParams)};

  /**
   * MainButton и BackButton — настоящими элементами, а не заглушками.
   *
   * Клиент Telegram рисует их сам, вне страницы, и заглушка-пустышка
   * означала бы, что главное действие экрана в браузерной проверке просто
   * недоступно: нажать нечего. Обвязка, из-за которой нельзя проверить
   * основной сценарий, бесполезна, поэтому кнопки создаются в DOM
   * и ведут себя как настоящие — текст, видимость, блокировка, прогресс.
   */
  function makeButton(id, label) {
    var el = document.createElement('button');
    el.id = id;
    el.type = 'button';
    el.hidden = true;
    el.setAttribute('data-telegram-stub', label);
    // Закреплены поверх окна, а не в потоке документа: в клиенте эти кнопки
    // рисуются вне страницы, и при клиентском переходе Next вставлял свою
    // разметку после них — на скриншоте главное действие оказывалось
    // над содержимым экрана, чего в Telegram не бывает
    el.style.cssText =
      'position:fixed;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));' +
      'z-index:2147483000;display:block;min-height:48px;' +
      'border:0;border-radius:12px;font-size:16px;font-weight:500;' +
      'background:' + theme.button_color + ';color:' + theme.button_text_color + ';';
    return el;
  }

  var mainEl = makeButton('tg-main-button', 'MainButton');
  var backEl = makeButton('tg-back-button', 'BackButton');
  backEl.style.background = 'transparent';
  backEl.style.color = theme.link_color || theme.button_color;
  // Системная стрелка в клиенте живёт в шапке — заглушка ставит её туда же,
  // чтобы она не спорила с главной кнопкой за место внизу
  backEl.style.top = 'calc(8px + env(safe-area-inset-top))';
  backEl.style.bottom = 'auto';
  backEl.style.left = '8px';
  backEl.style.right = 'auto';
  backEl.style.width = 'auto';
  backEl.style.minHeight = '32px';
  backEl.style.padding = '0 10px';
  backEl.style.fontSize = '14px';
  backEl.style.borderRadius = '16px';
  // Плашка под стрелкой: она рисуется поверх страницы, и без подложки
  // на скриншоте читалась бы как часть содержимого экрана
  backEl.style.background = theme.secondary_bg_color || '#f4f4f5';
  backEl.textContent = '‹ Назад';

  function mount() {
    if (!document.body) return;
    if (!mainEl.isConnected) document.body.appendChild(mainEl);
    if (!backEl.isConnected) document.body.appendChild(backEl);
  }

  function bind(el) {
    var handlers = [];
    return {
      get text() { return el.textContent || ''; },
      get isVisible() { return !el.hidden; },
      setText: function (t) { el.textContent = t; },
      show: function () { mount(); el.hidden = false; },
      hide: function () { el.hidden = true; },
      enable: function () { el.disabled = false; el.style.opacity = '1'; },
      disable: function () { el.disabled = true; el.style.opacity = '0.4'; },
      showProgress: function () { el.dataset.progress = '1'; },
      hideProgress: function () { delete el.dataset.progress; },
      onClick: function (cb) { handlers.push(cb); el.addEventListener('click', cb); },
      offClick: function (cb) { el.removeEventListener('click', cb); }
    };
  }

  var mainButton = bind(mainEl);
  var backButton = bind(backEl);

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
      MainButton: mainButton,
      SecondaryButton: bind(makeButton('tg-secondary-button', 'SecondaryButton')),
      BackButton: backButton,
      enableClosingConfirmation: function () { window.__tgClosingConfirmation = true; },
      disableClosingConfirmation: function () { window.__tgClosingConfirmation = false; },
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

  // Кнопки живут в конце body — его на момент выполнения скрипта ещё нет
  document.addEventListener('DOMContentLoaded', mount);
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

  /**
   * Настоящий telegram-web-app.js подключён в <head> приложения и при
   * загрузке присваивает window.Telegram заново. Вне клиента Telegram он
   * собирает WebApp с пустым initData — и затирает подписанную заглушку,
   * поставленную до разбора документа. Экран после этого показывает
   * «Приложение открыто вне Telegram», хотя в приложении всё исправно.
   * Поэтому скрипт подменяется пустым: мост в браузере даёт заглушка.
   */
  await page.route(/telegram-web-app\.js/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: '/* заменён заглушкой e2e/lib/telegram-stub.ts */',
    }),
  );

  await page.addInitScript({
    content: buildStubScript(initData, user, colorScheme, THEMES[colorScheme]),
  });

  return initData;
}

/** Размер экрана телефона: Mini App почти всегда открывают с него */
export const PHONE_VIEWPORT = { width: 390, height: 844 };
