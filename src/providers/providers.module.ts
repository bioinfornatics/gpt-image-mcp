import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PROVIDER_TOKEN } from './provider.interface';
import { OpenAIProvider } from './openai/openai.provider';
import { AzureOpenAIProvider } from './azure/azure.provider';
import type { AppConfig } from '../config/app.config';

@Module({
  providers: [
    {
      provide: PROVIDER_TOKEN,
      useFactory: (configService: ConfigService) => {
        const config = configService.get<AppConfig['provider']>('provider');
        if (config === 'azure') {
          const azure = configService.get<AppConfig['azure']>('azure')!;
          return new AzureOpenAIProvider({
            endpoint: azure.endpoint!,
            apiKey: azure.apiKey!,
            deployment: azure.deployment!,
            apiVersion: azure.apiVersion,
          });
        }
        const openai = configService.get<AppConfig['openai']>('openai')!;
        return new OpenAIProvider({
          apiKey: openai.apiKey!,
          baseUrl: openai.baseUrl,
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [PROVIDER_TOKEN],
})
export class ProvidersModule {}
