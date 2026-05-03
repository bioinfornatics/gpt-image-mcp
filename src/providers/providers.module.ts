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
        const ip = configService.get<AppConfig['imageProvider']>('imageProvider')!;

        if (ip.name === 'azure') {
          // Azure endpoint: https://my-resource.openai.azure.com → append /openai/v1
          const baseURL = ip.baseUrl.replace(/\/$/, '') + '/openai/v1';
          const client = new OpenAI({ baseURL, apiKey: ip.apiKey! });
          const strategy = new AzureStrategy(ip.deployment!);
          return new OpenAICompatibleProvider(client, strategy);
        }

        if (ip.name === 'together') {
          // Together AI base URL is always hardcoded — IMAGE_BASE_URL is not used
          const client = new OpenAI({
            baseURL: 'https://api.together.xyz/v1',
            apiKey: ip.apiKey!,
          });
          const strategy = new TogetherStrategy();
          return new OpenAICompatibleProvider(client, strategy);
        }

        if (ip.name === 'custom') {
          const client = new OpenAI({
            baseURL: ip.baseUrl,
            apiKey: ip.apiKey || 'none',
          });
          const strategy = new CustomStrategy();
          return new OpenAICompatibleProvider(client, strategy);
        }

        // Default: OpenAI (direct or via compatible endpoint)
        const client = new OpenAI({
          apiKey: ip.apiKey!,
          baseURL: ip.baseUrl,
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
