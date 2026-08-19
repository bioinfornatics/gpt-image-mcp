import { describe, expect, it } from 'bun:test';
import { inferFoundryEndpoint, withFoundryDefaults } from '../../../src/config/foundry-endpoint';

describe('inferFoundryEndpoint', () => {
  it('infers Azure and the resource/account name from a Foundry resource root', () => {
    expect(inferFoundryEndpoint('https://servier-difa-foundry-nprd.services.ai.azure.com')).toEqual({
      provider: 'azure',
      resourceName: 'servier-difa-foundry-nprd',
    });
  });

  it.each([
    'http://x.services.ai.azure.com',
    'https://x.services.ai.azure.com/path',
    'https://x.services.ai.azure.com.evil.example',
    'https://user:pass@x.services.ai.azure.com',
    'https://x.openai.azure.com',
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
