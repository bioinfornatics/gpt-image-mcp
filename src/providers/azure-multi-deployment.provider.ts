import type {
  IImageProvider,
  GenerateParams,
  EditParams,
  VariationParams,
  ImageResult,
  ValidationResult,
} from './provider.interface';
import type { AppConfig } from '../config/app.config';
import { AzureOpenAIClientFactory } from './azure-openai-client.factory';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { AzureStrategy } from './strategies/azure.strategy';
import { MaiImageProvider } from './mai-image.provider';
import { MAI_MODEL_NAME } from './mai-image.constants';
import { LATEST_MODEL } from '../config/models';

export interface AzureMultiDeploymentProviderOptions {
  config: AppConfig['imageProvider'];
  clients: Pick<AzureOpenAIClientFactory, 'createForDeployment' | 'createAuthHeaderProvider'>;
  fetchImpl?: typeof fetch;
}

/** Routes Azure requests to the API surface required by the selected deployed model. */
export class AzureMultiDeploymentProvider implements IImageProvider {
  readonly name = 'azure' as const;
  readonly defaultModel: string;
  readonly availableModels: readonly string[];

  private readonly config: AppConfig['imageProvider'];
  private readonly clients: AzureMultiDeploymentProviderOptions['clients'];
  private readonly fetchImpl?: typeof fetch;

  constructor(options: AzureMultiDeploymentProviderOptions) {
    this.config = options.config;
    this.clients = options.clients;
    this.fetchImpl = options.fetchImpl;
    this.defaultModel = options.config.deployment?.trim() || LATEST_MODEL;
    this.availableModels = [...new Set([this.defaultModel, MAI_MODEL_NAME, LATEST_MODEL])];
  }

  async generate(params: GenerateParams): Promise<ImageResult[]> {
    const model = this.resolveModel(params.model);
    const effective = model.toLowerCase() === LATEST_MODEL.toLowerCase() && params.moderation === 'auto'
      ? { ...params, model, moderation: undefined }
      : { ...params, model };
    return this.providerFor(model).generate(effective);
  }

  async edit(params: EditParams): Promise<ImageResult[]> {
    const model = this.resolveModel(params.model);
    return this.providerFor(model).edit({ ...params, model });
  }

  variation(_params: VariationParams): Promise<ImageResult[]> {
    return Promise.reject(new Error('image_variation is not supported by the Azure provider.'));
  }

  validate(): Promise<ValidationResult> {
    return this.providerFor(this.defaultModel).validate();
  }

  private resolveModel(requested: string | undefined): string {
    const model = requested?.trim() || this.defaultModel;
    const match = this.availableModels.find((candidate) => candidate.toLowerCase() === model.toLowerCase());
    if (!match) {
      throw new Error(
        `Unsupported Azure image model "${model}". Available deployed models: ${this.availableModels.join(', ')}.`,
      );
    }
    return match;
  }

  private providerFor(model: string): IImageProvider {
    if (model.toLowerCase() === MAI_MODEL_NAME.toLowerCase()) {
      return new MaiImageProvider({
        endpoint: this.config.baseUrl,
        deployment: model,
        authHeader: this.clients.createAuthHeaderProvider(this.config),
        fetchImpl: this.fetchImpl,
      });
    }
    if (model.toLowerCase() === LATEST_MODEL.toLowerCase()) {
      return new OpenAICompatibleProvider(
        this.clients.createForDeployment(this.config, model),
        new AzureStrategy(model, this.config.azureAuthMode),
      );
    }
    throw new Error(`No Azure image adapter is registered for model "${model}".`);
  }
}
