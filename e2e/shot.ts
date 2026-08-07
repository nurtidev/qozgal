import { webkit, chromium, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { installTelegramStub, PHONE_VIEWPORT, type ColorScheme } from './lib/telegram-stub';

/**
 * Снимает экран Mini App в браузере с подменённым мостом Telegram.
 *
 * Зачем WebKit по умолчанию: это движок Safari, а на iOS Telegram открывает
 * Mini App именно в нём. Расхождения с Chromium в вёрстке — safe-area,
 * поведение 100vh при появлении клавиатуры, отрисовка шрифтов — на телефоне
 * заметны, а в Chromium невидимы.
 *
 * Помимо картинки собираются ошибки консоли и упавшие запросы: сломанный
 * вызов API выглядит на скриншоте как пустой блок, и без лога причину
 * не отличить от задуманной пустоты.
 *
 * Usage:
 *   tsx e2e/shot.ts <url> [--dark] [--chromium] [--out путь.png]
 */

const args = process.argv.slice(2);
const urlArg = args.find((a) => !a.startsWith('--'));
if (!urlArg) {
  console.error('usage: tsx e2e/shot.ts <url> [--dark] [--chromium] [--out файл.png]');
  process.exit(2);
}
const url: string = urlArg;

const colorScheme: ColorScheme = args.includes('--dark') ? 'dark' : 'light';
const engine = args.includes('--chromium') ? chromium : webkit;
const engineName = args.includes('--chromium') ? 'chromium' : 'webkit';

const outIndex = args.indexOf('--out');
const outPath =
  outIndex >= 0 && args[outIndex + 1]
    ? args[outIndex + 1]
    : `e2e/screenshots/${engineName}-${colorScheme}.png`;

async function main() {
  await mkdir(outPath.replace(/\/[^/]+$/, ''), { recursive: true });

  const browser = await engine.launch();
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: PHONE_VIEWPORT,
    locale: 'ru-RU',
    timezoneId: 'Asia/Almaty',
  });

  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on('requestfailed', (req) =>
    failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`),
  );
  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
    }
  });

  await installTelegramStub(page, { colorScheme });

  const response = await page.goto(url, {
    waitUntil: 'networkidle',
    timeout: 30_000,
  });

  await page.screenshot({ path: outPath, fullPage: true });

  console.log(`Движок:     ${engineName}, тема ${colorScheme}`);
  console.log(`Ответ:      HTTP ${response?.status()}`);
  console.log(`Заголовок:  ${await page.title()}`);
  console.log(`Скриншот:   ${outPath}`);

  if (consoleErrors.length) {
    console.log(`\nОшибки консоли (${consoleErrors.length}):`);
    consoleErrors.slice(0, 10).forEach((e) => console.log(`  ${e}`));
  } else {
    console.log('Консоль:    чисто');
  }

  if (failedRequests.length) {
    console.log(`\nУпавшие запросы (${failedRequests.length}):`);
    failedRequests.slice(0, 10).forEach((r) => console.log(`  ${r}`));
  } else {
    console.log('Запросы:    все успешны');
  }

  await browser.close();
}

main().catch((error) => {
  console.error('Снимок не удался:', error instanceof Error ? error.message : error);
  process.exit(1);
});
