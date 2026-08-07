import { bot } from './bot';

/**
 * Запуск бота отдельным процессом через long polling.
 *
 * На Railway это второй сервис из того же репозитория со стартовой командой
 * `npm run bot`. Держать бота внутри Next.js нельзя: серверлесс-обработчики
 * живут секунды, а long polling требует постоянного процесса.
 *
 * Для продакшена альтернатива — вебхук на /api/telegram/webhook: он дешевле
 * по ресурсам, но требует публичного https и настроенного секрета.
 */
async function main() {
  await bot.api.setMyCommands([
    { command: 'start', description: 'Начать' },
    { command: 'today', description: 'Итог за сегодня' },
    { command: 'app', description: 'Открыть приложение' },
  ]);

  console.log('Бот запущен, слушаю обновления…');

  // Аккуратная остановка: grammY дорабатывает текущие апдейты, прежде чем
  // процесс завершится, иначе разбор фотографии оборвётся на полпути.
  process.once('SIGINT', () => bot.stop());
  process.once('SIGTERM', () => bot.stop());

  await bot.start({
    // Апдейты, накопившиеся за время простоя, не обрабатываем: отвечать
    // на фотографию, присланную час назад, бессмысленно.
    drop_pending_updates: true,
    allowed_updates: ['message', 'callback_query'],
  });
}

main().catch((error) => {
  console.error('Не удалось запустить бота:', error);
  process.exit(1);
});
