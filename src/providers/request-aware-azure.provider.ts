import type { IImageProvider, GenerateParams, EditParams, VariationParams, ImageResult, ValidationResult } from './provider.interface';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { AzureStrategy } from './strategies/azure.strategy';
import { AzureOpenAIClientFactory } from './azure-openai-client.factory';

/** Resolves an Azure client at invocation time so OBO tokens remain request-scoped. */
export class RequestAwareAzureProvider implements IImageProvider {
  readonly name = 'azure' as const;

  constructor(
    private readonly clients: AzureOpenAIClientFactory,
    private readonly deployment: string,
    private readonly authMode: 'api_key' | 'azure_cli' | 'on_behalf_of',
  ) {}

  generate(params: GenerateParams): Promise<ImageResult[]> { return this.provider().generate(params); }
  edit(params: EditParams): Promise<ImageResult[]> { return this.provider().edit(params); }
  variation(params: VariationParams): Promise<ImageResult[]> { return this.provider().variation(params); }
  validate(): Promise<ValidationResult> { return this.provider().validate(); }

  private provider(): OpenAICompatibleProvider {
    return new OpenAICompatibleProvider(this.clients.createCurrent(), new AzureStrategy(this.deployment, this.authMode));
  }
}
