import { and, eq, isNotNull } from 'drizzle-orm';

import { db } from './index';
import { foodEntries, foodItems } from './schema';
import {
  calibrate,
  dailyKcalImpact,
  MIN_EDITS_FOR_VERDICT,
  type CalibrationReport,
  type Slice,
  type WeightSample,
} from '@/lib/nutrition/calibration';

/**
 * Отчёт о том, насколько модель ошибается в весе порции.
 *
 * Приложение защищается от выдуманных калорий справочником нутриентов,
 * но вес порции остаётся зоной, где решает модель. Проверить её там нечем —
 * кроме одного: рядом с оценкой в базе лежит цифра, которую поставил
 * человек перед сохранением. Это единственный отзыв о качестве оценки,
 * который приложение получает само, без опросов и разметки.
 *
 * Скрипт ничего не меняет. Он отвечает на один вопрос: есть ли
 * систематическое смещение, и если да, в какую сторону. Случайный разброс
 * на пяти записях в день гасится сам, смещение — накапливается.
 *
 * Запуск: node --env-file=.env node_modules/.bin/tsx src/db/audit-weights.ts
 * Против прода — с его DATABASE_URL: локальная база отражает только сиды.
 */

/** Ориентир для перевода процентов в килокалории дня */
const TYPICAL_DAILY_KCAL = 2200;

async function main() {
  /**
   * Только подтверждённые записи: черновик человек ещё не смотрел, и его
   * «правка» — это отсутствие правки, а не согласие с оценкой. Отменённые
   * не берём тем более: там оценка не важна никому.
   */
  const rows = await db
    .select({
      grams: foodItems.grams,
      estimated: foodItems.aiEstimatedGrams,
      confidence: foodItems.aiConfidence,
      productId: foodItems.productId,
      source: foodEntries.source,
      entryId: foodEntries.id,
    })
    .from(foodItems)
    .innerJoin(foodEntries, eq(foodEntries.id, foodItems.entryId))
    .where(
      and(
        eq(foodEntries.status, 'confirmed'),
        isNotNull(foodItems.aiEstimatedGrams),
      ),
    );

  // Повтор приёма пищи копирует уже проверенные числа: там нет оценки
  // модели, и включать его в статистику — значит разбавлять её нулями
  const usable = rows.filter(
    (row) => row.source !== 'repeat' && row.source !== 'manual',
  );

  const samples: WeightSample[] = usable.map((row) => ({
    estimatedG: row.estimated!,
    finalG: row.grams,
    confidence: row.confidence,
    source: row.source as WeightSample['source'],
    matched: row.productId !== null,
  }));

  const entries = new Set(usable.map((row) => row.entryId)).size;
  const report = calibrate(samples);

  console.log('\nКалибровка оценки веса');
  console.log('══════════════════════');
  console.log(
    `${samples.length} позиций из ${entries} подтверждённых приёмов пищи` +
      (rows.length !== usable.length
        ? ` (отброшено ${rows.length - usable.length}: повторы и ручной ввод)`
        : ''),
  );

  if (samples.length === 0) {
    console.log('\nДанных нет: подтверждённых записей с оценкой модели не найдено.');
    console.log('Если смотрите локальную базу — это ожидаемо, оценки копятся в проде.');
    process.exit(0);
  }

  printOverall(report);

  printSlices('По источнику', report.bySource);
  printSlices('По уверенности модели', report.byConfidence);
  printSlices('По справочнику', report.byMatch);

  printCaveats(report);
}

function printOverall(report: CalibrationReport) {
  const { overall, spread } = report;

  console.log(
    `\nПравок веса: ${overall.edits} из ${overall.count} (${pct(overall.editShare)})`,
  );

  if (overall.biasEdited === null) {
    console.log('Ни одной правки — смещение считать не от чего.');
    return;
  }

  const direction = overall.biasEdited > 0 ? 'занижает' : 'завышает';
  console.log(
    `Смещение по правленым: ${signed(overall.biasEdited)} — модель ${direction}`,
  );
  console.log(`Смещение по всем позициям: ${signed(overall.biasAll ?? 0)}`);

  if (spread.p25 !== null && spread.p75 !== null) {
    console.log(
      `Половина правок укладывается в ${signed(spread.p25)}…${signed(spread.p75)}`,
    );
  }

  // Проценты человеку ничего не говорят, килокалории говорят всё
  const impact = dailyKcalImpact(overall.biasEdited * overall.editShare, TYPICAL_DAILY_KCAL);
  if (Math.abs(impact) >= 10) {
    console.log(
      `\nЕсли смещение переносится на весь дневник — около ${signed_kcal(impact)} ккал ` +
        `в день при рационе ${TYPICAL_DAILY_KCAL}.`,
    );
  }
}

function printSlices(title: string, slices: Slice[]) {
  if (slices.length === 0) return;
  console.log(`\n${title}`);
  for (const slice of slices) {
    const bias = slice.biasEdited === null ? '—' : signed(slice.biasEdited);
    console.log(
      `  ${slice.label.padEnd(22)} ${String(slice.count).padStart(4)} поз. · ` +
        `правок ${String(slice.edits).padStart(3)} (${pct(slice.editShare).padStart(4)}) · ` +
        `смещение ${bias}`,
    );
  }
}

function printCaveats(report: CalibrationReport) {
  console.log('\nЧто с этим делать');

  if (!report.enoughData) {
    console.log(
      `  Правок меньше ${MIN_EDITS_FOR_VERDICT} — выводы делать рано.\n` +
        '  На десятке наблюдений медиана скачет от одной записи, и «модель\n' +
        '  занижает на 20%» будет означать лишь то, что кто-то однажды\n' +
        '  доложил себе добавку.',
    );
  } else if (Math.abs(report.overall.biasEdited ?? 0) < 0.05) {
    console.log('  Систематического смещения не видно — трогать промпт незачем.');
  } else {
    const direction = (report.overall.biasEdited ?? 0) > 0 ? 'занижена' : 'завышена';
    console.log(
      `  Оценка систематически ${direction}. Это правится ориентирами в промпте\n` +
        '  (src/lib/ai/prompts.ts, раздел «Как оценивать вес»), а не коэффициентом\n' +
        '  поверх ответа: подкрутка множителем скрывает причину и ломается\n' +
        '  на следующей смене модели.',
    );
  }

  console.log(
    '\n  Оговорка: отсутствие правки не означает верную оценку — человек мог\n' +
      '  подтвердить не глядя. Поэтому смещение по всем позициям заведомо\n' +
      '  занижено, и решения стоит принимать по строке «по правленым».',
  );
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
const signed = (value: number) =>
  `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
const signed_kcal = (value: number) => `${value > 0 ? '+' : ''}${value}`;

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Не удалось собрать отчёт:', error);
    process.exit(1);
  });
