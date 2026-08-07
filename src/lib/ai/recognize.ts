import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { BetaContentBlockParam } from '@anthropic-ai/sdk/resources/beta/messages';

import { env } from '@/env';
import { FOOD_RECOGNITION_SYSTEM, buildTimeHint } from './prompts';
import {
  recognitionSchema,
  FAILURE_MESSAGES,
  type Recognition,
  type RecognitionOutcome,
  type RecognitionFailure,
} from './schemas';

const MODEL = 'claude-opus-5';

/**
 * Уровень усилий модели — главная ручка компромисса «качество / задержка / цена».
 *
 * Распознавание идёт в интерактивном пути: пользователь ждёт ответа в чате.
 * Задача при этом узкая — извлечь состав из одного изображения, а не вести
 * многошаговое рассуждение, и на Opus 5 средний уровень даёт качество,
 * близкое к максимальному, заметно дешевле и быстрее.
 *
 * Вынесено в переменную окружения, чтобы сравнивать варианты на своей
 * выборке блюд, не трогая код.
 */
const EFFORT = (process.env.RECOGNITION_EFFORT ?? 'medium') as
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

/**
 * Потолок вывода. Учитывает и рассуждение модели, и сам JSON: на Opus 5
 * мышление включено по умолчанию и расходует этот же лимит, поэтому запас
 * взят с большим отрывом от размера ответа.
 */
const MAX_TOKENS = 8192;

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export type ImageMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif';

export interface RecognizeInput {
  /** Фотография блюда в base64, без префикса data: */
  imageBase64?: string;
  imageMediaType?: ImageMediaType;
  /** Текстовое описание: «две сосиски и гречка» */
  text?: string;
  /** Локальный час пользователя — уточняет предположение о приёме пищи */
  localHour?: number;
}

/* ─────────────────────────── Вызов модели ──────────────────────────── */

interface RawCallResult {
  recognition: Recognition | null;
  stopReason: string | null;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

async function callModel(
  content: BetaContentBlockParam[],
  withFallbacks: boolean,
): Promise<RawCallResult> {
  const response = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,

    // Классификаторы безопасности могут отклонить запрос; серверный фолбэк
    // переигрывает его на другой модели в рамках того же вызова, вместо того
    // чтобы возвращать пользователю отказ на безобидном фото еды.
    ...(withFallbacks
      ? {
          betas: ['server-side-fallback-2026-07-01' as const],
          fallbacks: 'default' as const,
        }
      : {}),

    // Промпт не меняется между вызовами, а вызовов много — кешируем его,
    // чтобы не платить за одни и те же токены на каждой фотографии.
    system: [
      {
        type: 'text',
        text: FOOD_RECOGNITION_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],

    output_config: {
      effort: EFFORT,
      format: betaZodOutputFormat(recognitionSchema),
    },

    messages: [{ role: 'user', content }],
  });

  return {
    recognition: response.parsed_output,
    stopReason: response.stop_reason,
    model: response.model,
    usage: response.usage,
  };
}

/**
 * Определяет состав еды по фотографии и/или описанию.
 *
 * Модель возвращает только состав и вес — калорийность подставляется
 * отдельно, из справочника нутриентов. Ошибки не пробрасываются наружу:
 * вызывающий код получает размеченный отказ с текстом для пользователя.
 */
export async function recognizeFood(
  input: RecognizeInput,
): Promise<RecognitionOutcome> {
  const { imageBase64, imageMediaType, text, localHour } = input;

  if (!imageBase64 && !text?.trim()) {
    return fail('empty');
  }

  const content: BetaContentBlockParam[] = [];

  if (imageBase64 && imageMediaType) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageMediaType,
        data: imageBase64,
      },
    });
  }

  const parts: string[] = [];
  if (text?.trim()) {
    parts.push(
      imageBase64
        ? `Подпись пользователя к фото: ${text.trim()}`
        : `Описание съеденного: ${text.trim()}`,
    );
  }
  if (localHour != null) {
    parts.push(buildTimeHint(localHour));
  }
  if (parts.length === 0) {
    parts.push('Определи состав блюда на фотографии.');
  }
  content.push({ type: 'text', text: parts.join('\n') });

  const startedAt = Date.now();

  let result: RawCallResult;
  try {
    result = await callModel(content, true);
  } catch (error) {
    // Серверные фолбэки — относительно свежая бета. Если конкретный аккаунт
    // или регион её ещё не принимает, разбор еды не должен падать целиком:
    // повторяем тот же запрос без неё и пишем предупреждение в лог.
    if (isFallbackRejection(error)) {
      console.warn(
        'Серверные фолбэки отклонены API, повтор без них:',
        error instanceof Error ? error.message : error,
      );
      try {
        result = await callModel(content, false);
      } catch (retryError) {
        return apiFailure(retryError);
      }
    } else {
      return apiFailure(error);
    }
  }

  const latencyMs = Date.now() - startedAt;

  // Отказ приходит успешным HTTP-ответом, а не исключением, поэтому
  // проверяется до чтения содержимого.
  if (result.stopReason === 'refusal') {
    return fail('refused');
  }

  const recognition = result.recognition;
  if (!recognition) return fail('malformed');
  if (!recognition.isFood) return fail('not_food');
  if (recognition.items.length === 0) return fail('empty');

  return {
    ok: true,
    recognition: sanitize(recognition),
    meta: {
      model: result.model,
      latencyMs,
      inputTokens: result.usage.input_tokens,
      outputTokens: result.usage.output_tokens,
      cacheReadTokens: result.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: result.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

/* ─────────────────────────── Постобработка ─────────────────────────── */

/**
 * Схема гарантирует типы, но не здравый смысл: модель может вернуть
 * отрицательный вес или уверенность больше единицы. Приводим к диапазону
 * здесь, чтобы дальше по коду эти значения можно было считать корректными.
 */
function sanitize(recognition: Recognition): Recognition {
  return {
    ...recognition,
    items: recognition.items
      .map((item) => ({
        ...item,
        grams: clamp(Math.round(item.grams), 1, 5000),
        confidence: clamp(item.confidence, 0, 1),
        nameRu: item.nameRu.trim(),
        nameEn: item.nameEn.trim(),
      }))
      .filter((item) => item.nameRu.length > 0),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isFallbackRejection(error: unknown): boolean {
  if (!(error instanceof Anthropic.BadRequestError)) return false;
  return /fallback|beta/i.test(error.message);
}

function apiFailure(error: unknown): RecognitionOutcome {
  console.error('Ошибка вызова модели распознавания:', error);
  return fail('api_error');
}

function fail(reason: RecognitionFailure): RecognitionOutcome {
  return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
}
