import { AzureOpenAIProvider } from '../../../src/providers/azure/azure.provider';

const mockGenerate = jest.fn();
const mockEdit = jest.fn();
const mockModelsList = jest.fn();

jest.mock('openai', () => {
  return {
    AzureOpenAI: jest.fn().mockImplementation(() => ({
      images: {
        generate: mockGenerate,
        edit: mockEdit,
      },
      models: {
        list: mockModelsList,
      },
    })),
  };
});

const validConfig = {
  endpoint: 'https://test.openai.azure.com',
  apiKey: 'azure-test-key-abc123',
  deployment: 'my-gpt-image-deployment',
  apiVersion: '2025-04-01-preview',
};

describe('AzureOpenAIProvider', () => {
  let provider: AzureOpenAIProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new AzureOpenAIProvider(validConfig);
  });

  describe('name', () => {
    it('should be "azure"', () => {
      expect(provider.name).toBe('azure');
    });
  });

  describe('generate()', () => {
    it('should return ImageResult[] on success', async () => {
      mockGenerate.mockResolvedValue({
        created: 1_700_000_000,
        data: [{ b64_json: 'YXp1cmVpbWc=' }],
      });
      const results = await provider.generate({ prompt: 'a cat', model: 'gpt-image-1' });
      expect(results).toHaveLength(1);
      expect(results[0].b64_json).toBe('YXp1cmVpbWc=');
      // model should be the deployment name
      expect(results[0].model).toBe(validConfig.deployment);
    });

    it('should throw rate-limit error on 429 response', async () => {
      mockGenerate.mockRejectedValue(new Error('429 Too Many Requests'));
      await expect(provider.generate({ prompt: 'a', model: 'gpt-image-1' }))
        .rejects.toThrow(/rate limit/i);
    });

    it('should throw auth error on 401 response', async () => {
      mockGenerate.mockRejectedValue(new Error('401 Unauthorized'));
      await expect(provider.generate({ prompt: 'a', model: 'gpt-image-1' }))
        .rejects.toThrow(/authentication/i);
    });

    it('should throw deployment not found error on 404', async () => {
      mockGenerate.mockRejectedValue(new Error('404 Not Found'));
      await expect(provider.generate({ prompt: 'a', model: 'gpt-image-1' }))
        .rejects.toThrow(/not found|deployment/i);
    });
  });

  describe('variation()', () => {
    it('should always throw — Azure does not support variation', async () => {
      await expect(provider.variation({ image: 'ZmFrZQ==' }))
        .rejects.toThrow(/not supported|azure/i);
    });
  });

  describe('validate()', () => {
    it('should return valid=true when models list succeeds', async () => {
      mockModelsList.mockResolvedValue({ data: [] });
      const result = await provider.validate();
      expect(result.valid).toBe(true);
      expect(result.provider).toBe('azure');
    });

    it('should return valid=false on failure', async () => {
      mockModelsList.mockRejectedValue(new Error('connection error'));
      const result = await provider.validate();
      expect(result.valid).toBe(false);
    });
  });
});
