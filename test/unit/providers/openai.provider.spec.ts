import { OpenAIProvider } from '../../../src/providers/openai/openai.provider';

// Mock the entire openai module
const mockGenerate = jest.fn();
const mockEdit = jest.fn();
const mockCreateVariation = jest.fn();
const mockModelsList = jest.fn();

// Simulate OpenAI APIError with a status code
class FakeAPIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

jest.mock('openai', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      images: {
        generate: mockGenerate,
        edit: mockEdit,
        createVariation: mockCreateVariation,
      },
      models: {
        list: mockModelsList,
      },
    })),
    APIError: FakeAPIError,
  };
});

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new OpenAIProvider({ apiKey: 'sk-test-key' });
  });

  describe('generate()', () => {
    it('should return ImageResult[] on success', async () => {
      mockGenerate.mockResolvedValue({
        created: 1_700_000_000,
        data: [{ b64_json: 'ZmFrZQ==' }],
      });
      const results = await provider.generate({ prompt: 'a cat', model: 'gpt-image-1' });
      expect(results).toHaveLength(1);
      expect(results[0].b64_json).toBe('ZmFrZQ==');
      expect(results[0].model).toBe('gpt-image-1');
    });

    it('should throw rate-limit error on 429', async () => {
      mockGenerate.mockRejectedValue(new FakeAPIError('rate limited', 429));
      await expect(provider.generate({ prompt: 'a cat', model: 'gpt-image-1' }))
        .rejects.toThrow(/rate limit/i);
    });

    it('should throw auth error on 401', async () => {
      mockGenerate.mockRejectedValue(new FakeAPIError('unauthorized', 401));
      await expect(provider.generate({ prompt: 'a cat', model: 'gpt-image-1' }))
        .rejects.toThrow(/authentication/i);
    });

    it('should throw not-found error on 404', async () => {
      mockGenerate.mockRejectedValue(new FakeAPIError('not found', 404));
      await expect(provider.generate({ prompt: 'a cat', model: 'gpt-image-1' }))
        .rejects.toThrow(/not found/i);
    });

    it('should NEVER log the API key', async () => {
      const apiKey = 'sk-test-supersecretkey1234567890abc';
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockGenerate.mockRejectedValue(new Error('some error with ' + apiKey));
      const prov = new OpenAIProvider({ apiKey });
      await prov.generate({ prompt: 'test', model: 'gpt-image-1' }).catch(() => {});
      const allLogs = [...logSpy.mock.calls.flat(), ...errSpy.mock.calls.flat()].join(' ');
      expect(allLogs).not.toContain(apiKey);
      logSpy.mockRestore();
      errSpy.mockRestore();
    });
  });

  describe('validate()', () => {
    it('should return valid=true when models list succeeds', async () => {
      mockModelsList.mockResolvedValue({ data: [] });
      const result = await provider.validate();
      expect(result.valid).toBe(true);
      expect(result.provider).toBe('openai');
    });

    it('should return valid=false when API call fails', async () => {
      mockModelsList.mockRejectedValue(new Error('connection refused'));
      const result = await provider.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should not expose API key in validation error', async () => {
      const apiKey = 'sk-secret-validate-key-123456789abc';
      mockModelsList.mockRejectedValue(new Error(`Auth failed: ${apiKey}`));
      const prov = new OpenAIProvider({ apiKey });
      const result = await prov.validate();
      expect(result.valid).toBe(false);
      expect(result.error).not.toContain(apiKey);
    });
  });

  describe('name', () => {
    it('should be "openai"', () => {
      expect(provider.name).toBe('openai');
    });
  });
});
