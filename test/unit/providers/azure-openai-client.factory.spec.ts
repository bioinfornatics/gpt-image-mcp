import { describe, it, expect, mock } from 'bun:test';
import { AzureOpenAIClientFactory, AZURE_OPENAI_SCOPE, type AzureCredentialProviderFactory } from '../../../src/providers/azure-openai-client.factory';
import type { AppConfig } from '../../../src/config/app.config';

const base: AppConfig['imageProvider'] = {
  name: 'azure', baseUrl: 'https://unit.openai.azure.com/', deployment: 'images',
  apiVersion: '2025-04-01-preview', models: [], azureAuthMode: 'api_key', apiKey: 'secret',
};

describe('AzureOpenAIClientFactory', () => {
  it('creates API-key clients without requesting a token provider', () => {
    const create = mock(() => async () => 'token');
    const factory = new AzureOpenAIClientFactory({ createAzureCliTokenProvider: create } as AzureCredentialProviderFactory);
    const client = factory.create(base) as unknown as { apiKey: string; baseURL: string };
    expect(client.apiKey).toBe('secret');
    expect(client.baseURL).toContain('unit.openai.azure.com');
    expect(create).not.toHaveBeenCalled();
  });

  it('creates Azure CLI clients with tenant-aware refreshable token provider', () => {
    const tokenProvider = mock(() => Promise.resolve('refreshable-token'));
    const create = mock(() => tokenProvider);
    const factory = new AzureOpenAIClientFactory({ createAzureCliTokenProvider: create } as AzureCredentialProviderFactory);
    const client = factory.create({ ...base, apiKey: undefined, azureAuthMode: 'azure_cli', azureTenantId: 'tenant-a' }) as unknown as { apiKey: string };
    expect(create).toHaveBeenCalledWith('tenant-a');
    expect(client.apiKey).not.toBe('secret');
  });

  it('requires an OBO token service', () => {
    expect(() => new AzureOpenAIClientFactory().create({ ...base, azureAuthMode: 'on_behalf_of', apiKey: undefined })).toThrow(/token service/);
  });

  it('uses the Cognitive Services default scope', () => {
    expect(AZURE_OPENAI_SCOPE).toBe('https://cognitiveservices.azure.com/.default');
  });
});
