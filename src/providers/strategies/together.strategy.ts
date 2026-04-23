import { maskSecret } from '../../security/sanitise';
import type { ProviderStrategy } from './provider.strategy';
import type { GenerateParams, EditParams } from '../provider.interface';

export class TogetherStrategy implements ProviderStrategy {
  readonly name = 'together' as const;
  readonly logPrefix = '[Together]';
  readonly supportsVariation = false;

  resolveModel(params: Pick<GenerateParams, 'model'>): string {
    return params.model || 'black-forest-labs/FLUX.1-schnell-Free';
  }

  buildGenerateExtras(_params: GenerateParams, _model: string): Record<string, unknown> {
    return { response_format: 'b64_json' as const };
  }

  buildEditExtras(_params: EditParams): Record<string, unknown> {
    // Together does not support edit
    throw new Error('image_edit is not supported by the Together AI provider.');
  }

  normalizeError(err: unknown): Error {
    if (err instanceof Error) {
      const msg = maskSecret(err.message);
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        return new Error('Authentication failed: check your TOGETHER_API_KEY.');
      }
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        return new Error(`Rate limit exceeded (Together AI): ${msg}`);
      }
      if (msg.includes('400')) {
        return new Error(`Bad request (Together AI): ${msg}. Check model name and parameters.`);
      }
      return new Error(`Together AI error: ${msg}`);
    }
    return new Error(String(err));
  }
}
