/**
 * Single source of truth for model identifiers.
 *
 * When OpenAI / Azure releases a new generation, update LATEST_MODEL here — nowhere else.
 * Every default in schemas, config, strategies, and tool descriptions derives from this value.
 */

/** The current flagship model — used as the default when no model is explicitly supplied. */
export const LATEST_MODEL = 'gpt-image-2' as const;

/** Full model catalogue per provider — drives provider_list tool output. */
export const OPENAI_MODELS = [
  'gpt-image-2',
  'gpt-image-1',
  'gpt-image-1.5',
  'gpt-image-1-mini',
  'dall-e-3',
  'dall-e-2',
] as const;

export const AZURE_MODELS = [
  'gpt-image-2',
  'gpt-image-1',
  'gpt-image-1.5',
  'dall-e-3',
] as const;

export type ModelName = (typeof OPENAI_MODELS)[number] | (typeof AZURE_MODELS)[number];
