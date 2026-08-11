import { env } from '@/env';
import { explainMatches, pickBestMatch } from '@/lib/nutrition/match';
import { searchUsdaCandidates } from '@/lib/nutrition/usda';
import type { Preparation } from '@/lib/ai/schemas';

/**
 * Проба отбора карточек USDA на живой выдаче.
 *
 * Юнит-тесты `match.test.ts` проверяют алгоритм на строках, которые я знал
 * заранее, — то есть на своих же ожиданиях. Веса при этом решают судьбу
 * чисел, которые человек увидит как посчитанные, поэтому смотреть надо на
 * настоящий ответ USDA: он присылает не то, что ожидалось, и присылает это
 * в неожиданном порядке.
 *
 * Скрипт ничего не пишет в базу. Он печатает всех кандидатов с их счётом,
 * отмечает выбранного и отброшенных — так видно не только «что выбрали»,
 * но и «что при этом отвергли», а второе важнее: молча отброшенный
 * правильный продукт оставит позицию без нутриентов.
 *
 * Запуск: npm run probe:usda
 */

interface Probe {
  nameEn: string;
  preparation?: Preparation;
  /** Чего мы ждём — словами, для чтения глазами, не для проверки */
  expect: string;
}

/**
 * Набор — то, что действительно присылают: базовые продукты, где ошибка
 * повторяется каждый день, и блюда, которых в USDA быть не должно (проверка
 * на то, что отказ работает).
 */
const PROBES: Probe[] = [
  { nameEn: 'apple', expect: 'обычное яблоко ~52 ккал, не Rose-apples (25)' },
  { nameEn: 'banana', expect: 'банан ~89' },
  { nameEn: 'rice', preparation: 'boiled', expect: 'варёный рис ~130, не сухой (360)' },
  { nameEn: 'buckwheat', preparation: 'boiled', expect: 'варёная гречка ~92, не зерно (343)' },
  { nameEn: 'potato', preparation: 'boiled', expect: 'варёный картофель ~87' },
  { nameEn: 'potato', preparation: 'fried', expect: 'жареный картофель ~270' },
  { nameEn: 'chicken breast', preparation: 'grilled', expect: 'грудка готовая ~165' },
  { nameEn: 'beef', preparation: 'boiled', expect: 'варёная говядина, не сырая' },
  { nameEn: 'egg', preparation: 'boiled', expect: 'варёное яйцо ~155' },
  { nameEn: 'whole milk', expect: 'цельное молоко ~61, не обезжиренное (34)' },
  { nameEn: 'bread', expect: 'хлеб ~265' },
  { nameEn: 'buttermilk', expect: 'близко к айрану ~40' },
  { nameEn: 'cottage cheese', expect: 'творог ~98' },
  { nameEn: 'sunflower oil', expect: 'масло ~884' },
  { nameEn: 'tomato', preparation: 'raw', expect: 'помидор ~18' },
  { nameEn: 'onion', preparation: 'fried', expect: 'жареный лук' },
  { nameEn: 'carrot', preparation: 'boiled', expect: 'варёная морковь ~35' },
  { nameEn: 'lamb', preparation: 'boiled', expect: 'баранина готовая — ключевой ингредиент куырдака' },
  { nameEn: 'wheat flour', expect: 'мука ~364' },
  { nameEn: 'sugar', expect: 'сахар ~387' },
  { nameEn: 'beshbarmak', expect: 'отказ: в USDA такого нет' },
  { nameEn: 'kurt', expect: 'отказ: в USDA такого нет' },
  { nameEn: 'baursak', expect: 'отказ: в USDA такого нет' },
];

const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

async function main() {
  if (!env.USDA_API_KEY) {
    console.error('Нужен USDA_API_KEY в .env');
    process.exit(1);
  }

  let accepted = 0;
  let rejected = 0;

  for (const probe of PROBES) {
    const input = { nameEn: probe.nameEn, preparation: probe.preparation };

    // Тот же путь, которым идёт резолвер, — иначе проба проверяла бы
    // не работающий код, а свою копию его логики
    const candidates = await searchUsdaCandidates(input, env.USDA_API_KEY);
    const explained = explainMatches(input, candidates);
    const best = pickBestMatch(input, candidates);

    if (best) accepted++;
    else rejected++;

    console.log(`\n${'─'.repeat(72)}`);
    console.log(`запрос: ${probe.nameEn}${probe.preparation ? ` (${probe.preparation})` : ''}`);
    console.log(`${DIM}ждём:   ${probe.expect}${RESET}`);

    if (candidates.length === 0) {
      console.log(`${YELLOW}USDA не вернула ничего${RESET}`);
      continue;
    }

    // Порядок вывода — как отдала USDA: видно, насколько её представление
    // о релевантности расходится с нашим
    explained.forEach((e, index) => {
      const mark =
        e.product === best ? `${GREEN}▸${RESET}` : e.accepted ? ' ' : `${DIM}×${RESET}`;
      const score = e.score === null ? 'не тот' : e.score.toFixed(1);
      const line = `${mark} ${String(index + 1).padStart(2)}. ${String(Math.round(e.product.kcalPer100g)).padStart(4)} ккал  ${score.padStart(6)}  ${e.product.nameEn}`;
      console.log(e.accepted ? line : `${DIM}${line}${RESET}`);
    });

    if (best) {
      console.log(`${GREEN}итог:   ${Math.round(best.kcalPer100g)} ккал — ${best.nameEn}${RESET}`);
    } else if (explained.some((e) => e.accepted)) {
      // Отказ при подходящих кандидатах — сработала защита от угадывания
      console.log(
        `${YELLOW}итог:   отказ — подходящие разошлись в калорийности${RESET}`,
      );
    } else {
      console.log(`${YELLOW}итог:   отказ — ни один кандидат не подошёл${RESET}`);
    }
  }

  console.log(`\n${'═'.repeat(72)}`);
  console.log(`выбрано ${accepted}, отказов ${rejected} из ${PROBES.length}`);
  console.log(
    `${DIM}Отказ — не всегда ошибка: для беспармака и курта он правильный ответ.${RESET}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
