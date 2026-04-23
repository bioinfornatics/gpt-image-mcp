import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PROVIDER_TOKEN } from './provider.interface';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { OpenAIStrategy } from './strategies/openai.strategy';
import { AzureStrategy } from './strategies/azure.strategy';
import type { AppConfig } from '../config/app.config';

@Module({
  providers: [
    {
      provide: PROVIDER_TOKEN,
      useFactory: (configService: ConfigService): OpenAICompatibleProvider => {
        const providerName = configService.get<AppConfig['provider']>('provider');

        if (providerName === 'azure') {
          const azure = configService.get<AppConfig['azure']>('azure')!;
          const baseURL = azure.endpoint!.replace(/\/$/, '') + '/openai/v1';
          const client = new OpenAI({ baseURL, apiKey: azure.apiKey! });
          const strategy = new AzureStrategy(azure.deployment!);
          return new OpenAICompatibleProvider(client, strategy);
        }

        // Default: OpenAI (direct or via compatible endpoint)
        const openai = configService.get<AppConfig['openai']>('openai')!;
        const client = new OpenAI({
          apiKey: openai.apiKey!,
          ...(openai.baseUrl ? { baseURL: openai.baseUrl } : {}),
        });
        const strategy = new OpenAIStrategy();
        return new OpenAICompatibleProvider(client, strategy);
      },
      inject: [ConfigService],
    },
  ],
  exports: [PROVIDER_TOKEN],
})
export class ProvidersModule {}
