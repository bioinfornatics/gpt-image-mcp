import { maskSecret } from '../../security/sanitise';
import type { ProviderStrategy } from './provider.strategy';
import type { GenerateParams, EditParams } from '../provider.interface';

export class AzureStrategy implements ProviderStrategy {
  readonly name = 'azure' as const;
  readonly logPrefix = '[Azure]';
  readonly supportsVariation = false;

  constructor(private readonly deployment: string) {}

  resolveModel(_params: Pick<GenerateParams, 'model'>): string {
    // Azure always uses the deployment name, not the model from params
    return this.deployment;
  }

  buildGenerateExtras(_params: GenerateParams, _model: string): Record<string, unknown> {
    // Azure GPT-image models do not support response_format parameter — images are
    // returned as b64_json by default.
    return {};
  }

  buildEditExtras(_params: EditParams): Record<string, unknown> {
    // Same as above: no response_format for Azure edit requests.
    return {};
  }

  normalizeError(err: unknown): Error {
    if (err instanceof Error) {
      const msg = maskSecret(err.message);
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        return new Error(`Rate limit exceeded (Azure): ${msg}. Please wait before retrying.`);
      }
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        return new Error('Authentication failed: invalid API key for Azure AI Foundry provider.');
      }
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
        return new Error(
          `Access denied (Azure): ${msg}. ` +
          `If using gpt-image-2, this model requires explicit access approval — ` +
          `request access via the Azure portal before using it.`,
        );
      }
      if (msg.includes('404')) {
        return new Error(`Model not found: ${this.deployment}. Check AZURE_OPENAI_DEPLOYMENT.`);
      }
      return new Error(`Azure AI Foundry error: ${msg}`);
    }
    return new Error(String(err));
  }
}
