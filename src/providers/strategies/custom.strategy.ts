import { maskSecret } from '../../security/sanitise';
import type { ProviderStrategy } from './provider.strategy';
import type { GenerateParams, EditParams } from '../provider.interface';

export class CustomStrategy implements ProviderStrategy {
  readonly name = 'custom' as const;
  readonly logPrefix = '[Custom]';
  readonly supportsVariation = false;

  resolveModel(params: Pick<GenerateParams, 'model'>): string {
    return params.model || 'custom';
  }

  buildGenerateExtras(params: GenerateParams, model: string): Record<string, unknown> {
    const isDallE = model.startsWith('dall-e');
    if (isDallE) return { response_format: 'b64_json' as const };
    return {
      response_format: 'b64_json' as const,
      ...(params.background ? { background: params.background } : {}),
      ...(params.output_format ? { output_format: params.output_format } : {}),
      ...(params.output_compression !== undefined ? { output_compression: params.output_compression } : {}),
    };
  }

  buildEditExtras(params: EditParams): Record<string, unknown> {
    return {
      response_format: 'b64_json' as const,
      ...(params.quality && params.quality !== 'auto' ? { quality: params.quality } : {}),
      ...(params.output_format ? { output_format: params.output_format } : {}),
    };
  }

  normalizeError(err: unknown): Error {
    if (err instanceof Error) {
      const msg = maskSecret(err.message);
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        return new Error(`Authentication failed (Custom): check CUSTOM_OPENAI_API_KEY.`);
      }
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        return new Error(`Rate limit exceeded (Custom): ${msg}`);
      }
      return new Error(`Custom OpenAI-compatible endpoint error: ${msg}`);
    }
    return new Error(String(err));
  }
}
