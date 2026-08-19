import { describe, expect, it } from 'bun:test';
import { inferFoundryEndpoint, withFoundryDefaults } from '../../../src/config/foundry-endpoint';

describe('inferFoundryEndpoint', () => {
  it('infers Azure and the resource/account name from a Foundry resource root', () => {
    expect(inferFoundryEndpoint('https://servier-difa-foundry-nprd.services.ai.azure.com')).toEqual({
      provider: 'azure',
      resourceName: 'servier-difa-foundry-nprd',
    });
  });

  it('detects official OpenAI, Azure OpenAI and OpenRouter roots', () => {
    expect(inferFoundryEndpoint('https://api.openai.com/v1')?.provider).toBe('openai');
    expect(inferFoundryEndpoint('https://x.openai.azure.com')?.provider).toBe('azure');
    expect(inferFoundryEndpoint('https://openrouter.ai/api/v1')?.provider).toBe('openrouter');
  });

  it.each([
    'http://x.services.ai.azure.com',
    'https://x.services.ai.azure.com/path',
    'https://x.services.ai.azure.com.evil.example',
    'https://user:pass@x.services.ai.azure.com',
    'not-a-url',
  ])('rejects non-canonical or deceptive endpoint %s', (url) => {
    expect(inferFoundryEndpoint(url)).toBeUndefined();
  });
});

describe('withFoundryDefaults', () => {
  const baseUrl = 'https://resource.services.ai.azure.com';

  it('infers only the provider because a project name is not encoded in the resource URL', () => {
    expect(withFoundryDefaults({ baseUrl }, {})).toEqual({ baseUrl, provider: 'azure' });
  });

  it('infers the OpenRouter default model while preserving an explicit model', () => {
    expect(withFoundryDefaults({ baseUrl: 'https://openrouter.ai/api/v1' }, {})).toEqual({
      baseUrl: 'https://openrouter.ai/api/v1', provider: 'openrouter',
      defaultModel: 'google/gemini-3.1-flash-image',
    });
    expect(withFoundryDefaults({ baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'microsoft/mai-image-2.5' }, {}))
      .toEqual({ baseUrl: 'https://openrouter.ai/api/v1', provider: 'openrouter', defaultModel: 'microsoft/mai-image-2.5' });
  });

  it('preserves explicit CLI values', () => {
    expect(withFoundryDefaults({
      baseUrl, provider: 'custom', foundryProjectEndpoint: `${baseUrl}/api/projects/explicit`,
    }, {})).toEqual({
      baseUrl, provider: 'custom', foundryProjectEndpoint: `${baseUrl}/api/projects/explicit`,
    });
  });

  it('preserves canonical environment provider configuration', () => {
    expect(withFoundryDefaults({ baseUrl }, { IMAGE_PROVIDER: 'custom' })).toEqual({ baseUrl });
  });
});
