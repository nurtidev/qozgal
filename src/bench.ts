import { readFileSync } from 'node:fs';
import { recognizeFood } from '@/lib/ai/recognize';

/**
 * Тарифы, долларов за миллион токенов.
 * Чтение кеша — 0.1× от входной цены, запись — 1.25×.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  // Действует вводная цена $2/$10 до 31.08.2026; считаем по обычной,
  // чтобы планировать экономику на то, что будет после
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

async function main() {
  const path = process.argv[2];
  const model = process.env.RECOGNITION_MODEL ?? 'claude-opus-5';
  const base64 = readFileSync(path).toString('base64');

  const started = Date.now();
  const outcome = await recognizeFood({
    imageBase64: base64,
    imageMediaType: 'image/jpeg',
    localHour: 13,
  });
  const elapsed = Date.now() - started;

  if (!outcome.ok) {
    console.log(`  ОТКАЗ: ${outcome.reason} — ${outcome.message}`);
    return;
  }

  const { recognition, meta } = outcome;
  for (const item of recognition.items) {
    console.log(
      `  • ${item.nameRu} (${item.nameEn}) — ${item.grams} г · уверенность ${Math.round(item.confidence * 100)}%`,
    );
  }

  const p = PRICING[model] ?? PRICING['claude-opus-5'];
  const systemTokens = meta.cacheWriteTokens || meta.cacheReadTokens;
  const cost =
    (meta.inputTokens * p.input +
      meta.outputTokens * p.output +
      systemTokens * p.input * 0.1) /
    1_000_000;

  console.log(
    `  → ${elapsed} мс · вход ${meta.inputTokens} + кеш ${systemTokens} · выход ${meta.outputTokens}`,
  );
  console.log(
    `  → ${(cost * 100).toFixed(3)} ¢ за разбор · $${(cost * 150).toFixed(2)} на пользователя в месяц`,
  );
}

main().catch((e) => {
  console.error('  УПАЛО:', e instanceof Error ? e.message : e);
  process.exit(1);
});
