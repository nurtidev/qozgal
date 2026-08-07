import { recognizeFood } from '@/lib/ai/recognize';

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

const CASES = [
  'две сосиски и гречка',
  'бешбармак и пиала сорпы',
  'куриная грудка 200 грамм, рис и салат из огурцов с помидорами',
];

async function main() {
  const model = process.env.RECOGNITION_TEXT_MODEL ?? 'claude-haiku-4-5';
  const p = PRICING[model] ?? PRICING['claude-haiku-4-5'];

  let totalCost = 0;
  let totalMs = 0;

  for (const text of CASES) {
    const started = Date.now();
    const outcome = await recognizeFood({ text, localHour: 13 });
    const elapsed = Date.now() - started;
    totalMs += elapsed;

    if (!outcome.ok) {
      console.log(`  «${text}» → ОТКАЗ: ${outcome.reason}`);
      continue;
    }

    const items = outcome.recognition.items
      .map((i) => `${i.nameRu} ${i.grams}г [${i.nameEn}]`)
      .join(', ');
    console.log(`  «${text}»`);
    console.log(`     → ${items}`);

    const m = outcome.meta;
    const systemTokens = m.cacheWriteTokens || m.cacheReadTokens;
    // Записанный в кеш префикс стоит 1.25×, прочитанный — 0.1×
    const systemPrice = m.cacheWriteTokens > 0 ? p.input * 1.25 : p.input * 0.1;
    const cost =
      (m.inputTokens * p.input +
        m.outputTokens * p.output +
        systemTokens * systemPrice) /
      1_000_000;
    totalCost += cost;

    console.log(
      `     → ${elapsed} мс · вход ${m.inputTokens} · кеш(чт) ${m.cacheReadTokens} · кеш(зп) ${m.cacheWriteTokens} · выход ${m.outputTokens} · ${(cost * 100).toFixed(3)}¢`,
    );
  }

  const avg = totalCost / CASES.length;
  console.log(
    `\n  Среднее: ${Math.round(totalMs / CASES.length)} мс · ${(avg * 100).toFixed(3)}¢ за разбор · $${(avg * 150).toFixed(2)} на пользователя в месяц`,
  );
}

main().catch((e) => {
  console.error('  УПАЛО:', e instanceof Error ? e.message : e);
  process.exit(1);
});
