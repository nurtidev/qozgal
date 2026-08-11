import type { NewProduct } from '@/db/schema';
import { env } from '@/env';
import { searchUsdaCandidates } from '@/lib/nutrition/usda';
import { pickBestMatch } from '@/lib/nutrition/match';
import { KAZAKH_FOODS } from './seed-data/kazakh-foods';
import { KAZAKH_RECIPES, type Recipe, type RecipeComponent } from './seed-data/kazakh-recipes';

/**
 * Пересчёт блюд местной кухни от состава.
 *
 * Это второй по надёжности способ из тех, что перечислены в шапке
 * kazakh-foods.ts: разложить блюдо на компоненты и сложить их нутриенты
 * из USDA. Первый — таблицы химического состава — требует источника,
 * которого у нас пока нет.
 *
 * Чем он полезен, если на выходе снова оценка. Тем, что оценка становится
 * разбираемой. Сейчас в карточке бешбармака стоит 218 ккал и неизвестно,
 * откуда; расчёт скажет, что получается, например, 170, и покажет, что
 * половину даёт отварное тесто. Дальше спор идёт о доле мяса и жирности —
 * то есть о вещах, которые человек знает и может поправить, а не о готовом
 * числе, о котором сказать нечего.
 *
 * Что скрипт НЕ делает: не меняет карточки и не ставит isVerified. Расчёт
 * от состава — не измерение, и подменять одну оценку другой молча значило бы
 * потерять единственное, что у нас есть про эти цифры, — знание, что они
 * непроверенные.
 *
 * Совпадение расчёта с карточкой тоже не доказательство: обе оценки делал
 * один человек, исходя из одних представлений о блюде. Ценно расхождение —
 * оно указывает на ошибку хотя бы в одной из них.
 *
 * Запуск: npm run audit:recipes
 */

const DIM = '\x1b[2m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

/** Расхождение, ниже которого расчёт и карточка считаются согласными */
const CLOSE = 0.1;
/** Выше этого расхождение уже нельзя объяснить разбросом рецептур */
const WIDE = 0.25;

interface Nutrients {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

interface Resolved {
  component: RecipeComponent;
  product: NewProduct | null;
  /** Откуда взялись числа — своя карточка или USDA */
  from: 'local' | 'usda' | null;
}

/** Свои карточки ищем по английскому названию: состав задан на нём */
function findLocal(nameEn: string): NewProduct | null {
  const needle = nameEn.trim().toLowerCase();
  return (
    KAZAKH_FOODS.find((p) => p.nameEn?.trim().toLowerCase() === needle) ?? null
  );
}

async function resolveComponent(component: RecipeComponent): Promise<Resolved> {
  const local = findLocal(component.nameEn);
  if (local) return { component, product: local, from: 'local' };

  const input = { nameEn: component.nameEn, preparation: component.preparation };
  const candidates = await searchUsdaCandidates(input, env.USDA_API_KEY);
  const product = pickBestMatch(input, candidates);

  return { component, product, from: product ? 'usda' : null };
}

function scale(product: NewProduct, grams: number): Nutrients {
  const k = grams / 100;
  return {
    kcal: product.kcalPer100g * k,
    protein: product.proteinPer100g * k,
    fat: product.fatPer100g * k,
    carbs: product.carbsPer100g * k,
  };
}

function sum(parts: Nutrients[]): Nutrients {
  return parts.reduce(
    (acc, p) => ({
      kcal: acc.kcal + p.kcal,
      protein: acc.protein + p.protein,
      fat: acc.fat + p.fat,
      carbs: acc.carbs + p.carbs,
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

function deviation(computed: number, card: number): number {
  return card === 0 ? 0 : (computed - card) / card;
}

function mark(spread: number): string {
  const abs = Math.abs(spread);
  if (abs <= CLOSE) return ' ';
  return abs > WIDE ? `${RED}!${RESET}` : `${YELLOW}~${RESET}`;
}

function percent(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${Math.round(value * 100)}%`;
}

async function auditRecipe(recipe: Recipe): Promise<number | null> {
  const card = KAZAKH_FOODS.find((p) => p.externalId === recipe.externalId);
  if (!card) {
    console.error(`Карточки ${recipe.externalId} нет в справочнике`);
    return null;
  }

  const resolved = await Promise.all(recipe.components.map(resolveComponent));

  const total = recipe.components.reduce((acc, c) => acc + c.grams, 0) + recipe.waterG;
  const missing = resolved.filter((r) => !r.product);

  console.log(`\n${'─'.repeat(74)}`);
  console.log(`${card.nameRu} ${DIM}(${recipe.externalId})${RESET}`);

  // Ошибка в самих долях делает расчёт бессмысленным, и молчать о ней нельзя
  if (Math.abs(total - 100) > 0.5) {
    console.log(
      `${RED}состав даёт ${total} г вместо 100 — доли заданы неверно${RESET}`,
    );
    return null;
  }

  for (const { component, product, from } of resolved) {
    const line = `${String(component.grams).padStart(3)} г  ${component.nameEn}`;
    if (!product) {
      console.log(`${DIM}${line} — нутриентов не нашлось${RESET}`);
      continue;
    }
    const part = scale(product, component.grams);
    console.log(
      `${line.padEnd(34)} ${String(Math.round(part.kcal)).padStart(4)} ккал  ` +
        `${DIM}${from === 'local' ? 'свой справочник' : product.nameEn}${RESET}`,
    );
  }

  if (recipe.waterG > 0) {
    console.log(`${DIM}${String(recipe.waterG).padStart(3)} г  вода${RESET}`);
  }

  if (missing.length > 0) {
    console.log(
      `${YELLOW}не хватает ${missing.length} из ${resolved.length} компонентов — сумма заведомо занижена${RESET}`,
    );
  }

  const computed = sum(
    resolved
      .filter((r) => r.product)
      .map((r) => scale(r.product!, r.component.grams)),
  );

  const spread = deviation(computed.kcal, card.kcalPer100g);

  console.log(
    `${mark(spread)} расчёт ${Math.round(computed.kcal)} ккал ` +
      `(Б ${computed.protein.toFixed(1)} Ж ${computed.fat.toFixed(1)} У ${computed.carbs.toFixed(1)}) ` +
      `против карточки ${Math.round(card.kcalPer100g)} ` +
      `(Б ${card.proteinPer100g} Ж ${card.fatPer100g} У ${card.carbsPer100g})  ` +
      `${percent(spread)}`,
  );
  console.log(`${DIM}спорное место: ${recipe.weakest}${RESET}`);

  return missing.length > 0 ? null : spread;
}

async function main() {
  if (!env.USDA_API_KEY) {
    console.error('Нужен USDA_API_KEY в .env');
    process.exit(1);
  }

  const spreads: { name: string; spread: number }[] = [];

  for (const recipe of KAZAKH_RECIPES) {
    const spread = await auditRecipe(recipe);
    const card = KAZAKH_FOODS.find((p) => p.externalId === recipe.externalId);
    if (spread !== null && card) {
      spreads.push({ name: card.nameRu, spread });
    }
  }

  const withoutRecipe = KAZAKH_FOODS.filter(
    (p) => !KAZAKH_RECIPES.some((r) => r.externalId === p.externalId),
  );

  console.log(`\n${'═'.repeat(74)}`);

  const wide = spreads.filter((s) => Math.abs(s.spread) > WIDE);
  const close = spreads.filter((s) => Math.abs(s.spread) <= CLOSE);

  console.log(
    `Сошлось в пределах ${Math.round(CLOSE * 100)}%: ${close.length} из ${spreads.length}`,
  );

  if (wide.length > 0) {
    console.log(`\nРасходится больше ${Math.round(WIDE * 100)}% — проверять первыми:`);
    for (const { name, spread } of [...wide].sort(
      (a, b) => Math.abs(b.spread) - Math.abs(a.spread),
    )) {
      console.log(`  ${percent(spread).padStart(5)}  ${name}`);
    }
  }

  console.log(
    `\n${DIM}Без состава осталось ${withoutRecipe.length} карточек: ${withoutRecipe
      .map((p) => p.nameRu)
      .join(', ')}.${RESET}`,
  );
  console.log(
    `${DIM}Часть из них сверяется с USDA напрямую (npm run audit:foods), а курт,${RESET}`,
  );
  console.log(
    `${DIM}иримшик, шубат и кумыс разложить на компоненты нельзя — там сквашивание.${RESET}`,
  );
  console.log(
    `\n${DIM}Совпадение расчёта с карточкой ничего не доказывает: обе оценки делались${RESET}`,
  );
  console.log(
    `${DIM}из одних представлений о блюде. Ценно расхождение.${RESET}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
