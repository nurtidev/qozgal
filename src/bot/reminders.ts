import { differenceInCalendarDays, parseISO } from 'date-fns';

/**
 * Утренние вопросы про вес и талию.
 *
 * Здесь только решения — что распознать в сообщении и пора ли спрашивать.
 * Работы с базой и Telegram нет намеренно: от этих правил зависит, не
 * превратится ли бот в источник шести одинаковых сообщений в час, и
 * проверять их надо тестом, а не живым чатом.
 *
 * Зачем вообще спрашивать. График веса имеет смысл на отрезке: дневное
 * колебание доходит до полутора килограммов, и по трём точкам тренд
 * не построить. Без напоминания взвешивания заносят первые дни, а потом
 * забывают — и экран веса остаётся с тремя засечками, по которым нельзя
 * сказать, работает дефицит или нет.
 */

/** Час, когда спрашиваем вес, и окно, за пределами которого уже не спрашиваем */
export const ASK_HOUR = 8;
const ASK_UNTIL_HOUR = 12;

/**
 * Раз в сколько дней спрашивать талию.
 *
 * Обхват меняется медленнее веса, и на недельном интервале разница обычно
 * не выходит за погрешность сантиметровой ленты — то есть человек тратит
 * замер, чтобы увидеть шум. За две недели виден сдвиг.
 */
export const WAIST_EVERY_DAYS = 14;

/** Разумные границы: ниже и выше человек ошибся, а не похудел */
const WEIGHT_RANGE = { min: 30, max: 250 };
const WAIST_RANGE = { min: 40, max: 200 };

/**
 * Число из сообщения, если оно там одно и без посторонних слов.
 *
 * «73.4», «73,4», «73.4 кг», «181 см» — да. «200 г риса» — нет: это еда,
 * и разбирать её надо моделью. Единицы допускаются только те, что относятся
 * к замеру, поэтому «2 яйца» тоже не пройдёт.
 */
export function parseMetric(text: string): number | null {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[.,]$/, '')
    .replace(/\s*(кг|kg|килограмм\w*|см|cm|сантиметр\w*)$/u, '')
    .trim();

  if (!/^\d{1,3}([.,]\d{1,2})?$/.test(cleaned)) return null;

  const value = Number(cleaned.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export function looksLikeWeight(value: number): boolean {
  return value >= WEIGHT_RANGE.min && value <= WEIGHT_RANGE.max;
}

export function looksLikeWaist(value: number): boolean {
  return value >= WAIST_RANGE.min && value <= WAIST_RANGE.max;
}

export interface WeightAskState {
  remindersOn: boolean;
  /** Локальный час пользователя */
  hour: number;
  /** Локальная дата пользователя */
  localDate: string;
  /** Когда вопрос задавали в прошлый раз, локальной датой */
  weightAskedOn: string | null;
  /** Записан ли вес за сегодня — тогда спрашивать нечего */
  hasWeightToday: boolean;
}

/**
 * Пора ли спрашивать вес.
 *
 * Окно, а не точный час: интервал просыпается раз в десять минут, и ровно
 * в 8:00 попасть не обязан. Верхняя граница нужна, чтобы человек, у которого
 * бот молчал (например, приложение развёрнуто днём), не получил вопрос про
 * вес натощак в четыре часа дня.
 */
export function shouldAskWeight(state: WeightAskState): boolean {
  if (!state.remindersOn) return false;
  if (state.hour < ASK_HOUR || state.hour >= ASK_UNTIL_HOUR) return false;
  // Уже спрашивали сегодня — второй раз человек воспримет как навязчивость,
  // а не как заботу
  if (state.weightAskedOn === state.localDate) return false;
  return !state.hasWeightToday;
}

export interface WaistAskState {
  localDate: string;
  /** Дата последнего замера талии, если он был */
  lastWaistOn: string | null;
  /** Когда про талию спрашивали в прошлый раз */
  waistAskedOn: string | null;
}

/**
 * Что сказать про обхваты вслед за присланным весом.
 *
 * Вопрос идёт следом за весом, а не отдельным сообщением: два вопроса
 * подряд утром — это уже анкета, её закрывают. А человек, который только
 * что назвал вес, стоит у зеркала и лента у него под рукой.
 *
 *  — `ask` — спросить талию числом. Годится, когда прошлый замер есть:
 *    обхват шеи в записи обязателен (он нужен для процента жира), и взять
 *    его можно только оттуда — шея почти не меняется;
 *  — `offer` — предложить сделать первый замер в приложении, где
 *    спрашивают все обхваты сразу. Без этого ветка с талией никогда
 *    не включалась: бот молчал, а человек не знал, что от него ждут;
 *  — `null` — молчать.
 *
 * Оба случая ограничены одним ритмом и одним полем `waistAskedOn`: раз
 * в две недели человека беспокоят про обхваты, и неважно, вопросом или
 * предложением.
 */
export type WaistPrompt = 'ask' | 'offer' | null;

export function waistPrompt(state: WaistAskState): WaistPrompt {
  if (state.waistAskedOn === state.localDate) return null;

  const asked = state.waistAskedOn
    ? differenceInCalendarDays(parseISO(state.localDate), parseISO(state.waistAskedOn))
    : null;

  // Про обхваты напоминаем в том же ритме, что и замеряем
  if (asked !== null && asked < WAIST_EVERY_DAYS) return null;

  if (!state.lastWaistOn) return 'offer';

  const days = differenceInCalendarDays(
    parseISO(state.localDate),
    parseISO(state.lastWaistOn),
  );
  return days >= WAIST_EVERY_DAYS ? 'ask' : null;
}
