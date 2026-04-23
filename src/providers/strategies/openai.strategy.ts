import { maskSecret } from '../../security/sanitise';
import type { ProviderStrategy } from './provider.strategy';
import type { GenerateParams, EditParams } from '../provider.interface';
import { LATEST_MODEL } from '../../config/models';

export class OpenAIStrategy implements ProviderStrategy {
  readonly name = 'openai' as const;
  readonly logPrefix = '';
  readonly supportsVariation = true;

  resolveModel(params: Pick<GenerateParams, 'model'>): string {
    return params.model ?? LATEST_MODEL;
  }

  buildGenerateExtras(params: GenerateParams, model: string): Record<string, unknown> {
    const isDallE = model.startsWith('dall-e');
    if (isDallE) {
      // DALL-E models: must request b64_json explicitly (default is URL)
      return { response_format: 'b64_json' as const };
    }
    // GPT-image models: support extra params, always return base64
    return {
      ...(params.background ? { background: params.background } : {}),
      ...(params.output_format ? { output_format: params.output_format } : {}),
      ...(params.output_compression !== undefined ? { output_compression: params.output_compression } : {}),
      ...(params.moderation ? { moderation: params.moderation } : {}),
    };
  }

  buildEditExtras(params: EditParams): Record<string, unknown> {
    return {
      response_format: 'b64_json' as const,
      ...(params.quality && params.quality !== 'auto' ? { quality: params.quality } : {}),
      ...(params.output_format ? { output_format: params.output_format } : {}),
      ...(params.output_compression !== undefined ? { output_compression: params.output_compression } : {}),
    };
  }

  normalizeError(err: unknown): Error {
    if (err && typeof err === 'object' && 'status' in err && err instanceof Error) {
      const status = (err as { status: number }).status;
      const msg = maskSecret(err.message);
      if (status === 429) return new Error(`Rate limit exceeded: ${msg}. Please wait before retrying.`);
      if (status === 401) return new Error('Authentication failed: invalid API key for OpenAI provider.');
      if (status === 403) return new Error(`Access denied: ${msg}`);
      if (status === 400) return new Error(`Bad request: ${msg}`);
      if (status === 404) return new Error(`Model or resource not found: ${msg}`);
      return new Error(`OpenAI API error (${status}): ${msg}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
