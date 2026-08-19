import type OpenAI from 'openai';
import type { GenerateParams, EditParams } from '../provider.interface';

/**
 * Encapsulates the behaviour that differs between OpenAI-compatible providers.
 * The shared HTTP client (openai npm SDK) is always `new OpenAI({...})`;
 * only the configuration and a handful of request-building decisions vary.
 */
export interface ProviderStrategy {
  /** Provider name returned by IImageProvider.name */
  readonly name: 'openai' | 'azure' | 'together' | 'custom';

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
   * Optional async deployment/model resolver boundary.
   *
   * When implemented (currently only {@link AzureStrategy}, when constructed
   * with an {@link AzureDeploymentCatalog}), this is awaited by
   * {@link OpenAICompatibleProvider} and its result is used as the wire
   * `model` field *instead of* {@link resolveModel}'s synchronous result —
   * e.g. Azure resolves an explicit `params.model` (a discovered
   * `modelName`, such as `microsoft/mai-image-2.5`) to the exact,
   * customer-chosen deployment name reported by the catalog. When no
   * catalog is configured, strategies simply omit this method and the
   * synchronous {@link resolveModel} result is used unchanged (existing
   * behaviour, zero risk to non-Azure strategies).
   *
   * This resolves *only* the wire model/deployment string — it never
   * replaces capability/family validation (see AzureStrategy.modelFamily),
   * which still fails fast for any deployment whose model family is not a
   * confirmed registry entry, regardless of catalog-based name resolution.
   */
  resolveModelAsync?(params: Pick<GenerateParams, 'model'>): Promise<string>;

  /**
   * Extra fields to spread into images.generate() beyond the common ones.
   * OpenAI: background, output_format, output_compression, moderation (GPT-image)
   *         OR response_format: 'b64_json' (DALL-E)
   * Azure:  response_format: 'b64_json' only
   *
   * May return a Promise: AzureStrategy resolves the deployment's model
   * family asynchronously through the {@link AzureDeploymentCatalog} (when
   * configured) before validating/building parameters.
   */
  buildGenerateExtras(params: GenerateParams, model: string): Record<string, unknown> | Promise<Record<string, unknown>>;

  /**
   * Extra fields to spread into images.edit() beyond the common ones.
   * Both providers need response_format: 'b64_json'.
   * OpenAI also passes quality, output_format, output_compression.
   *
   * May return a Promise (see {@link buildGenerateExtras}).
   */
  buildEditExtras(params: EditParams): Record<string, unknown> | Promise<Record<string, unknown>>;

  /** Optional provider-specific connectivity and configuration validation. */
  validate?(client: OpenAI): Promise<import('../provider.interface').ValidationResult>;

  /**
   * Map a raw API error to a user-friendly Error.
   * Providers differ on error messages (Azure adds gpt-image-2 403 guidance).
   */
  normalizeError(err: unknown): Error;
}
