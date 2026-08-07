import { webkit } from '@playwright/test';
import { installTelegramStub, PHONE_VIEWPORT } from './lib/telegram-stub';

/**
 * Проверяет, что подменённый мост Telegram виден странице и что подпись
 * initData настоящая — её принимает наш собственный валидатор.
 */
async function main() {
  const url = process.argv[2] ?? 'https://web-production-d5ef0.up.railway.app';

  const browser = await webkit.launch();
  const page = await (
    await browser.newContext({ viewport: PHONE_VIEWPORT })
  ).newPage();

  const initData = await installTelegramStub(page, { colorScheme: 'dark' });
  await page.goto(url, { waitUntil: 'networkidle' });

  const seen = await page.evaluate(() => {
    const w = window as unknown as {
      Telegram?: { WebApp?: Record<string, unknown> };
    };
    const app = w.Telegram?.WebApp;
    return {
      мостДоступен: Boolean(app),
      пользователь: (app?.initDataUnsafe as { user?: { first_name?: string } })
        ?.user?.first_name,
      длинаПодписи: (app?.initData as string)?.length ?? 0,
      тема: app?.colorScheme,
      цветФона: getComputedStyle(document.documentElement)
        .getPropertyValue('--tg-theme-bg-color')
        .trim(),
    };
  });

  console.log('Что видит страница:');
  for (const [k, v] of Object.entries(seen)) console.log(`  ${k}: ${v}`);

  // Та же проверка, что и на бэкенде: подпись должна пройти всерьёз
  const { validateInitData } = await import('@/lib/telegram/init-data');
  const result = validateInitData(initData, process.env.TELEGRAM_BOT_TOKEN!);
  console.log(
    `\nПодпись проходит нашу валидацию: ${result.ok ? 'да' : `нет — ${result.reason}`}`,
  );

  // И контрольный выстрел: подделанный id должен быть отвергнут
  const tampered = new URLSearchParams(initData);
  tampered.set('user', JSON.stringify({ id: 1, first_name: 'Чужой' }));
  const forged = validateInitData(
    tampered.toString(),
    process.env.TELEGRAM_BOT_TOKEN!,
  );
  console.log(
    `Подделанный id отвергается: ${!forged.ok ? `да (${forged.reason})` : 'НЕТ — это дыра'}`,
  );

  await browser.close();
}

main().catch((e) => {
  console.error('Проверка не удалась:', e instanceof Error ? e.message : e);
  process.exit(1);
});
