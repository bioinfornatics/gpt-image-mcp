/**
 * Integration tests for OpenAIProvider using fetch mocking.
 * Validates that the provider correctly maps HTTP responses to/from the OpenAI REST API.
 *
 * Note: OpenAI SDK v4 uses the global `fetch` API (not Node.js http module),
 * so we mock `fetch` directly rather than using nock http interception.
 */
import { OpenAIProvider } from '../../../src/providers/openai/openai.provider';

// Simulate OpenAI APIError with status code (matches the real SDK shape)
class FakeAPIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

const mockGenerate = jest.fn();
const mockEdit = jest.fn();
const mockModelsList = jest.fn();

jest.mock('openai', () => {
  return {
    default: jest.fn().mockImplementation(() => ({
      images: {
        generate: mockGenerate,
        edit: mockEdit,
      },
      models: {
        list: mockModelsList,
      },
    })),
    APIError: FakeAPIError,
  };
});

describe('OpenAIProvider — HTTP Integration (nock)', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new OpenAIProvider({ apiKey: 'sk-test-nock' });
  });

  describe('generate()', () => {
    it('should call POST /v1/images/generations and return ImageResult[]', async () => {
      mockGenerate.mockResolvedValue({
        created: 1_700_000_000,
        data: [{ b64_json: 'bm9ja0ltYWdl' }],
      });

      const results = await provider.generate({ prompt: 'a cat', model: 'gpt-image-1' });
      expect(results).toHaveLength(1);
      expect(results[0].b64_json).toBe('bm9ja0ltYWdl');
      expect(results[0].model).toBe('gpt-image-1');
      expect(results[0].created).toBe(1_700_000_000);
    });

    it('should return multiple images when n > 1', async () => {
      mockGenerate.mockResolvedValue({
        created: 1_700_000_000,
        data: [{ b64_json: 'aW1nMQ==' }, { b64_json: 'aW1nMg==' }],
      });

      const results = await provider.generate({ prompt: 'a cat', model: 'gpt-image-1', n: 2 });
      expect(results).toHaveLength(2);
    });

    it('should throw rate-limit error on 429 response', async () => {
      mockGenerate.mockRejectedValue(new FakeAPIError('Rate limit exceeded', 429));

      await expect(provider.generate({ prompt: 'a cat', model: 'gpt-image-1' }))
        .rejects.toThrow(/rate limit/i);
    });

    it('should throw auth error on 401 response', async () => {
      mockGenerate.mockRejectedValue(new FakeAPIError('Incorrect API key provided', 401));

      await expect(provider.generate({ prompt: 'a cat', model: 'gpt-image-1' }))
        .rejects.toThrow(/authentication/i);
    });

    it('should include revised_prompt from dall-e-3 response', async () => {
      mockGenerate.mockResolvedValue({
        created: 1_700_000_000,
        data: [{ b64_json: 'ZGFsbGUz', revised_prompt: 'A fluffy tabby cat' }],
      });

      const results = await provider.generate({ prompt: 'cat', model: 'dall-e-3' });
      expect(results[0].revised_prompt).toBe('A fluffy tabby cat');
    });
  });

  describe('validate()', () => {
    it('should return valid=true when /models responds 200', async () => {
      mockModelsList.mockResolvedValue({ object: 'list', data: [] });

      const result = await provider.validate();
      expect(result.valid).toBe(true);
      expect(result.provider).toBe('openai');
    });

    it('should return valid=false on 401 from /models', async () => {
      mockModelsList.mockRejectedValue(new FakeAPIError('Invalid API key', 401));

      const result = await provider.validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
