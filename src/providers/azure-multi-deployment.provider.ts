import type {
  IImageProvider, GenerateParams, EditParams, VariationParams, ImageResult, ValidationResult,
} from './provider.interface';
import type { AppConfig } from '../config/app.config';
import { AzureOpenAIClientFactory } from './azure-openai-client.factory';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { AzureStrategy } from './strategies/azure.strategy';
import { MaiImageProvider } from './mai-image.provider';
import { MAI_MODEL_NAME } from './mai-image.constants';
import { LATEST_MODEL } from '../config/models';
import { AzureDeploymentCatalog, type AzureDeploymentInfo } from './azure-deployment-catalog';

export interface AzureMultiDeploymentProviderOptions {
  config: AppConfig['imageProvider'];
  clients: Pick<AzureOpenAIClientFactory, 'createForDeployment' | 'createAuthHeaderProvider'>;
  fetchImpl?: typeof fetch;
  catalog?: AzureDeploymentCatalog;
}

type Adapter = 'mai' | 'openai';
interface Route { deployment: string; modelName: string; publisher: string; modelVersion?: string; adapter: Adapter }

/** Routes Azure requests using authoritative Foundry metadata when discovery is configured. */
export class AzureMultiDeploymentProvider implements IImageProvider {
  readonly name = 'azure' as const;
  readonly defaultModel: string;
  readonly availableModels: readonly string[];

  private readonly config: AppConfig['imageProvider'];
  private readonly clients: AzureMultiDeploymentProviderOptions['clients'];
  private readonly fetchImpl?: typeof fetch;
  private readonly catalog?: AzureDeploymentCatalog;

  constructor(options: AzureMultiDeploymentProviderOptions) {
    this.config = options.config;
    this.clients = options.clients;
    this.fetchImpl = options.fetchImpl;
    this.defaultModel = options.config.deployment?.trim() || LATEST_MODEL;
    this.availableModels = [...new Set([this.defaultModel, MAI_MODEL_NAME, LATEST_MODEL])];
    this.catalog = options.catalog ?? (options.config.foundryProjectEndpoint
      ? new AzureDeploymentCatalog({
          endpoint: options.config.foundryProjectEndpoint,
          // Foundry project deployment discovery is the documented v1 API;
          // IMAGE_API_VERSION belongs to inference and must not leak here.
          apiVersion: 'v1',
          authHeader: options.clients.createAuthHeaderProvider(options.config),
          fetchImpl: options.fetchImpl,
        })
      : undefined);
  }

  async listAvailableModels(): Promise<readonly string[]> {
    if (!this.catalog) return this.availableModels;
    return (await this.supportedRoutes()).map((route) => route.deployment);
  }

  async generate(params: GenerateParams): Promise<ImageResult[]> {
    const route = await this.resolveRoute(params.model);
    const effective = route.adapter === 'openai' && params.moderation === 'auto'
      ? { ...params, model: route.modelName, moderation: undefined }
      : { ...params, model: route.modelName };
    return this.providerFor(route).generate(effective);
  }

  async edit(params: EditParams): Promise<ImageResult[]> {
    const route = await this.resolveRoute(params.model);
    return this.providerFor(route).edit({ ...params, model: route.modelName });
  }

  variation(_params: VariationParams): Promise<ImageResult[]> {
    return Promise.reject(new Error('image_variation is not supported by the Azure provider.'));
  }

  async validate(): Promise<ValidationResult> {
    if (!this.catalog) return this.providerFor(this.staticRoute(this.defaultModel)).validate();
    try {
      const routes = await this.supportedRoutes();
      const foundDefault = routes.some((route) => route.deployment === this.defaultModel);
      return {
        valid: foundDefault,
        provider: this.name,
        deployment: this.defaultModel,
        models: routes.map((route) => route.deployment),
        deployments: routes.map(({ deployment, modelName, publisher, modelVersion, adapter }) => ({ deployment, modelName, publisher, modelVersion, adapter })),
        ...(!foundDefault ? { error: `Default Azure deployment "${this.defaultModel}" was not found as a supported image deployment.` } : {}),
      };
    } catch (error) {
      return { valid: false, provider: this.name, deployment: this.defaultModel, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async resolveRoute(requested: string | undefined): Promise<Route> {
    const target = requested?.trim() || this.defaultModel;
    if (!this.catalog) return this.staticRoute(target);
    const routes = await this.supportedRoutes();
    const exact = routes.find((route) => route.deployment === target);
    if (exact) return exact;
    const byModel = routes.filter((route) => route.modelName.toLowerCase() === target.toLowerCase());
    if (byModel.length === 1) return byModel[0];
    if (byModel.length > 1) {
      const preferred = byModel.find((route) => route.deployment === this.defaultModel);
      if (preferred) return preferred;
      throw new Error(`Azure model "${target}" is ambiguous across deployments: ${byModel.map((r) => r.deployment).join(', ')}. Pass an exact deployment name.`);
    }
    throw new Error(`Unsupported Azure image model/deployment "${target}". Available deployments: ${routes.map((r) => r.deployment).join(', ')}.`);
  }

  private async supportedRoutes(): Promise<Route[]> {
    const deployments = await this.catalog!.listDeployments();
    return deployments.flatMap((info) => {
      const route = this.routeFromInfo(info);
      return route ? [route] : [];
    });
  }

  private routeFromInfo(info: AzureDeploymentInfo): Route | undefined {
    const model = info.modelName?.trim();
    const publisher = info.modelPublisher?.trim();
    if (!model || !publisher) return undefined;
    if (model.toLowerCase() === LATEST_MODEL.toLowerCase() && publisher.toLowerCase() === 'openai') {
      return { deployment: info.name, modelName: LATEST_MODEL, publisher, modelVersion: info.modelVersion, adapter: 'openai' };
    }
    if (model.toLowerCase() === MAI_MODEL_NAME.toLowerCase() && publisher.toLowerCase() === 'microsoft') {
      return { deployment: info.name, modelName: MAI_MODEL_NAME, publisher, modelVersion: info.modelVersion, adapter: 'mai' };
    }
    return undefined;
  }

  private staticRoute(model: string): Route {
    const match = this.availableModels.find((candidate) => candidate.toLowerCase() === model.toLowerCase());
    if (!match) throw new Error(`Unsupported Azure image model "${model}". Available deployed models: ${this.availableModels.join(', ')}.`);
    return match.toLowerCase() === MAI_MODEL_NAME.toLowerCase()
      ? { deployment: match, modelName: MAI_MODEL_NAME, publisher: 'Microsoft', adapter: 'mai' }
      : { deployment: match, modelName: LATEST_MODEL, publisher: 'OpenAI', adapter: 'openai' };
  }

  private providerFor(route: Route): IImageProvider {
    if (route.adapter === 'mai') {
      return new MaiImageProvider({ endpoint: this.config.baseUrl, deployment: route.deployment,
        authHeader: this.clients.createAuthHeaderProvider(this.config), fetchImpl: this.fetchImpl });
    }
    return new OpenAICompatibleProvider(
      this.clients.createForDeployment(this.config, route.deployment),
      new AzureStrategy(route.deployment, this.config.azureAuthMode, undefined, route.modelName),
    );
  }
}
