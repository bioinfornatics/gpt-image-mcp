import type { GenerateParams, EditParams } from '../provider.interface';

/**
 * Encapsulates the behaviour that differs between OpenAI-compatible providers.
 * The shared HTTP client (openai npm SDK) is always `new OpenAI({...})`;
 * only the configuration and a handful of request-building decisions vary.
 */
export interface ProviderStrategy {
  /** Provider name returned by IImageProvider.name */
  readonly name: 'openai' | 'azure';

  /** Prefix for log messages, e.g. "[Azure]" or "" */
  readonly logPrefix: string;

  /** Whether this provider supports image variations (dall-e-2 only) */
  readonly supportsVariation: boolean;

  /**
   * Resolve which model string to send to the API.
   * OpenAI: use params.model
   * Azure:  always use the deployment name (ignores params.model)
   */
  resolveModel(params: Pick<GenerateParams, 'model'>): string;

  /**
   * Extra fields to spread into images.generate() beyond the common ones.
   * OpenAI: background, output_format, output_compression, moderation (GPT-image)
   *         OR response_format: 'b64_json' (DALL-E)
   * Azure:  response_format: 'b64_json' only
   */
  buildGenerateExtras(params: GenerateParams, model: string): Record<string, unknown>;

  /**
   * Extra fields to spread into images.edit() beyond the common ones.
   * Both providers need response_format: 'b64_json'.
   * OpenAI also passes quality, output_format, output_compression.
   */
  buildEditExtras(params: EditParams): Record<string, unknown>;

  /**
   * Map a raw API error to a user-friendly Error.
   * Providers differ on error messages (Azure adds gpt-image-2 403 guidance).
   */
  normalizeError(err: unknown): Error;
}
