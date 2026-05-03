import { z } from 'zod';
import { LATEST_MODEL, OPENAI_MODELS, AZURE_MODELS } from '../../config/models';

export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}

export const PROMPT_MAX_LENGTH_GPT = 32_000;
export const PROMPT_MAX_LENGTH_DALLE2 = 1_000; // dall-e-2: variations endpoint only

export const ImageGenerateSchema = z.object({
  prompt: z
    .string()
    .min(1, 'Prompt is required')
    .max(PROMPT_MAX_LENGTH_GPT, `Prompt exceeds maximum length of ${PROMPT_MAX_LENGTH_GPT} characters`)
    .describe('Text description of the image to generate (max 32 000 chars for GPT image models)'),
  model: z
    .string()
    .optional()
    .default(LATEST_MODEL)
    .describe(
      `Model to use. Default: ${LATEST_MODEL}. ` +
      `OpenAI: ${OPENAI_MODELS.filter(m => !m.startsWith('dall-e')).join(', ')} (+ dall-e-2 for variations only). ` +
      `Azure: ${AZURE_MODELS.join(', ')}.`,
    ),
  n: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(1)
    .describe('Number of images to generate (1–10; gpt-image-* models support up to 10)'),
  size: z
    .enum(['auto', '1024x1024', '1536x1024', '1024x1536'])
    .optional()
    .default('auto')
    .describe('Image dimensions'),
  quality: z
    .enum(['auto', 'high', 'medium', 'low'])
    .optional()
    .default('auto')
    .describe('Image quality level'),
  background: z
    .enum(['auto', 'transparent', 'opaque'])
    .optional()
    .describe('Background transparency (GPT image models only)'),
  output_format: z
    .enum(['png', 'jpeg', 'webp'])
    .optional()
    .describe('Output image format (GPT image models only)'),
  output_compression: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('Compression level 0–100 for webp/jpeg (GPT image models only)'),
  moderation: z
    .enum(['auto', 'low'])
    .optional()
    .describe('Content moderation level (GPT image models only)'),
  save_to_workspace: z
    .boolean()
    .optional()
    .default(false)
    .describe('Save generated image(s) to MCP workspace root directory'),
  skip_elicitation: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Set to true to suppress the interactive quality/size form and use defaults immediately. ' +
      'Useful for automated pipelines or when passing quality="auto" is intentional.',
    ),
  response_format: z
    .nativeEnum(ResponseFormat)
    .optional()
    .default(ResponseFormat.MARKDOWN)
    .describe('Output format: markdown (default) or json'),
});

export const ImageEditSchema = z.object({
  image: z
    .string()
    .min(1)
    .describe('Base64-encoded source image (PNG recommended, max 4 MB)'),
  mask: z
    .string()
    .optional()
    .describe('Base64-encoded mask image (white=edit area, black=keep)'),
  prompt: z
    .string()
    .min(1)
    .max(PROMPT_MAX_LENGTH_GPT)
    .describe('Description of the desired edit'),
  model: z
    .string()
    .optional()
    .default(LATEST_MODEL)
    .describe('Model to use for editing'),
  n: z.number().int().min(1).max(10).optional().default(1),
  size: z
    .enum(['auto', '1024x1024', '1536x1024', '1024x1536'])
    .optional()
    .default('auto'),
  quality: z.enum(['auto', 'high', 'medium', 'low']).optional().default('auto'),
  output_format: z.enum(['png', 'jpeg', 'webp']).optional(),
  output_compression: z.number().int().min(0).max(100).optional(),
  save_to_workspace: z.boolean().optional().default(false),
  response_format: z.nativeEnum(ResponseFormat).optional().default(ResponseFormat.MARKDOWN),
});

export const ImageVariationSchema = z.object({
  image: z
    .string()
    .min(1)
    .describe('Base64-encoded source image for variation (dall-e-2 only, must be square PNG)'),
  n: z.number().int().min(1).max(10).optional().default(1),
  size: z.enum(['256x256', '512x512', '1024x1024']).optional().default('1024x1024'),
  save_to_workspace: z.boolean().optional().default(false),
  response_format: z.nativeEnum(ResponseFormat).optional().default(ResponseFormat.MARKDOWN),
});

export const ProviderValidateSchema = z.object({
  provider: z.enum(['openai', 'azure']).describe('The provider to validate'),
});

/**
 * Resolves the moderation level, enforcing 'auto' unless ALLOW_LOW_MODERATION=true.
 * Moderation='low' bypasses OpenAI safety filters and requires explicit opt-in.
 */
export function resolveModeration(
  requested: 'auto' | 'low' | undefined,
): 'auto' | 'low' {
  if (requested === 'low' && process.env['ALLOW_LOW_MODERATION'] !== 'true') {
    return 'auto'; // silently downgrade — moderation=low requires explicit opt-in
  }
  return requested ?? 'auto';
}

export type ImageGenerateInput = z.infer<typeof ImageGenerateSchema>;
export type ImageEditInput = z.infer<typeof ImageEditSchema>;
export type ImageVariationInput = z.infer<typeof ImageVariationSchema>;
export type ProviderValidateInput = z.infer<typeof ProviderValidateSchema>;
