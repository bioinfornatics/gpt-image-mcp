/* c8 ignore file -- NestJS DI factory: exercised only with a real provider at runtime */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PROVIDER_TOKEN } from './provider.interface';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { OpenAIStrategy } from './strategies/openai.strategy';
import { AzureStrategy } from './strategies/azure.strategy';
import { TogetherStrategy } from './strategies/together.strategy';
import { CustomStrategy } from './strategies/custom.strategy';
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

        if (providerName === 'together') {
          const together = configService.get<AppConfig['together']>('together')!;
          const client = new OpenAI({
            baseURL: 'https://api.together.xyz/v1',
            apiKey: together.apiKey!,
          });
          const strategy = new TogetherStrategy();
          return new OpenAICompatibleProvider(client, strategy);
        }

        if (providerName === 'custom') {
          const custom = configService.get<AppConfig['custom']>('custom')!;
          const client = new OpenAI({
            baseURL: custom.baseUrl!,
            apiKey: custom.apiKey || 'none',
          });
          const strategy = new CustomStrategy();
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
