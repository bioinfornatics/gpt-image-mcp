/* c8 ignore file -- NestJS DI factory: exercised through integration tests */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PROVIDER_TOKEN, type IImageProvider } from './provider.interface';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { OpenAIStrategy } from './strategies/openai.strategy';
import { TogetherStrategy } from './strategies/together.strategy';
import { CustomStrategy } from './strategies/custom.strategy';
import { AzureOpenAIClientFactory, DefaultAzureCredentialProviderFactory } from './azure-openai-client.factory';
import { AzureMultiDeploymentProvider } from './azure-multi-deployment.provider';
import type { AppConfig } from '../config/app.config';

@Module({
  providers: [
    DefaultAzureCredentialProviderFactory,
    AzureOpenAIClientFactory,
    {
      provide: PROVIDER_TOKEN,
      useFactory: (config: ConfigService, azureClients: AzureOpenAIClientFactory): IImageProvider => {
        const ip = config.get<AppConfig['imageProvider']>('imageProvider')!;
        if (ip.name === 'azure') {
          return new AzureMultiDeploymentProvider({ config: ip, clients: azureClients });
        }
        if (ip.name === 'together') return new OpenAICompatibleProvider(new OpenAI({ baseURL: 'https://api.together.xyz/v1', apiKey: ip.apiKey! }), new TogetherStrategy());
        if (ip.name === 'custom') return new OpenAICompatibleProvider(new OpenAI({ baseURL: ip.baseUrl, apiKey: ip.apiKey || 'none' }), new CustomStrategy());
        return new OpenAICompatibleProvider(new OpenAI({ apiKey: ip.apiKey!, baseURL: ip.baseUrl }), new OpenAIStrategy());
      },
      inject: [ConfigService, AzureOpenAIClientFactory],
    },
  ],
  exports: [PROVIDER_TOKEN, AzureOpenAIClientFactory],
})
export class ProvidersModule {}
