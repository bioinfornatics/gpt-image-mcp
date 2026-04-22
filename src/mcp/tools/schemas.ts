import { z } from 'zod';

export enum ResponseFormat {
  MARKDOWN = 'markdown',
  JSON = 'json',
}

export const PROMPT_MAX_LENGTH_GPT = 32_000;
export const PROMPT_MAX_LENGTH_DALLE3 = 4_000;
export const PROMPT_MAX_LENGTH_DALLE2 = 1_000;

export const ImageGenerateSchema = z.object({
  prompt: z
    .string()
    .min(1, 'Prompt is required')
    .max(PROMPT_MAX_LENGTH_GPT, `Prompt exceeds maximum length of ${PROMPT_MAX_LENGTH_GPT} characters`)
    .describe('Text description of the image to generate (max 32 000 chars for GPT image models)'),
  model: z
    .string()
    .optional()
    .default('gpt-image-1')
    .describe('Model to use: gpt-image-1, gpt-image-1.5, gpt-image-1-mini, dall-e-3, dall-e-2'),
  n: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(1)
    .describe('Number of images to generate (1–10; dall-e-3 supports only n=1)'),
  size: z
    .enum(['auto', '1024x1024', '1536x1024', '1024x1536', '256x256', '512x512', '1792x1024', '1024x1792'])
    .optional()
    .default('auto')
    .describe('Image dimensions'),
  quality: z
    .enum(['auto', 'high', 'medium', 'low', 'hd', 'standard'])
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
    .default('gpt-image-1')
    .describe('Model to use for editing'),
  n: z.number().int().min(1).max(10).optional().default(1),
  size: z
    .enum(['auto', '1024x1024', '1536x1024', '1024x1536', '256x256', '512x512'])
    .optional()
    .default('auto'),
  quality: z.enum(['auto', 'high', 'medium', 'low', 'standard']).optional().default('auto'),
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

export type ImageGenerateInput = z.infer<typeof ImageGenerateSchema>;
export type ImageEditInput = z.infer<typeof ImageEditSchema>;
export type ImageVariationInput = z.infer<typeof ImageVariationSchema>;
export type ProviderValidateInput = z.infer<typeof ProviderValidateSchema>;
