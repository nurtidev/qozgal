import { bot } from './bot';
import { publishProfile } from './profile';
import { rollDailySummaries } from './pinned';
import { askMorningWeight } from './ask-metrics';

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
  // Описание, короткое описание и команды — на обоих языках. Ставятся при
  // старте: держать публичное лицо бота руками в BotFather значит однажды
  // обнаружить, что казахского варианта там никогда и не было
  await publishProfile(bot.api);

  /**
   * Закреплённые сводки переводим на новый день сами.
   *
   * Проверка идёт чаще полуночи, потому что полночь у каждого своя —
   * часовые пояса пользователей разные, а сверка дешёвая: один запрос
   * к базе и сообщение только тем, у кого дата действительно сменилась.
   */
  const ROLL_INTERVAL_MS = 10 * 60 * 1000;
  setInterval(() => {
    rollDailySummaries(bot.api).catch((error) =>
      console.error('Не удалось обновить закреплённые сводки:', error),
    );

    // Тем же интервалом и по той же причине: утро у каждого своё, и попасть
    // в него можно только сверяя локальное время
    askMorningWeight(bot.api).catch((error) =>
      console.error('Не удалось спросить вес:', error),
    );
  }, ROLL_INTERVAL_MS);

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
