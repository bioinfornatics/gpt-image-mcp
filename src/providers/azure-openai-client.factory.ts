import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AzureCliCredential, getBearerTokenProvider } from '@azure/identity';
import OpenAI, { AzureOpenAI } from 'openai';
import type { AppConfig } from '../config/app.config';
import { OBO_TOKEN_PROVIDER, type OboAzureTokenProvider } from './azure-obo-token.interface';

export const AZURE_OPENAI_SCOPE = 'https://cognitiveservices.azure.com/.default';
export type AzureTokenProvider = () => Promise<string>;

@Injectable()
export class DefaultAzureCredentialProviderFactory {
  createAzureCliTokenProvider(tenantId?: string): AzureTokenProvider {
    return getBearerTokenProvider(new AzureCliCredential(tenantId ? { tenantId } : undefined), AZURE_OPENAI_SCOPE);
  }
}

@Injectable()
export class AzureOpenAIClientFactory {
  private readonly providerConfig?: AppConfig['imageProvider'];

  constructor(
    @Optional() private readonly credentials: DefaultAzureCredentialProviderFactory = new DefaultAzureCredentialProviderFactory(),
    @Optional() @Inject(OBO_TOKEN_PROVIDER) private readonly obo?: OboAzureTokenProvider,
    @Optional() config?: ConfigService,
  ) {
    this.providerConfig = config?.get<AppConfig['imageProvider']>('imageProvider');
  }

  create(config: AppConfig['imageProvider']): OpenAI {
    const common = this.common(config);
    if (config.azureAuthMode === 'api_key') {
      if (!config.apiKey) throw new Error('IMAGE_API_KEY is required when IMAGE_AZURE_AUTH_MODE=api_key');
      return new AzureOpenAI({ ...common, apiKey: config.apiKey });
    }
    if (config.azureAuthMode === 'azure_cli') {
      return new AzureOpenAI({ ...common, azureADTokenProvider: this.credentials.createAzureCliTokenProvider(config.azureTenantId) });
    }
    if (!this.obo) throw new Error('OBO token service is unavailable.');
    return new AzureOpenAI({ ...common, azureADTokenProvider: () => this.obo!.acquireAzureOpenAIToken() });
  }

  createCurrent(): OpenAI {
    if (!this.providerConfig) throw new Error('Azure provider configuration is unavailable.');
    return this.create(this.providerConfig);
  }

  private common(config: AppConfig['imageProvider']) {
    if (config.name !== 'azure') throw new Error('AzureOpenAIClientFactory requires IMAGE_PROVIDER=azure');
    return { endpoint: config.baseUrl.replace(/\/$/, ''), deployment: config.deployment, apiVersion: config.apiVersion };
  }
}
