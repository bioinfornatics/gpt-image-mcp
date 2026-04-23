/**
 * Integration tests for OpenAICompatibleProvider (OpenAI strategy) using client injection.
 * Validates that the provider correctly maps responses to/from the OpenAI REST API.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OpenAICompatibleProvider } from '../../../src/providers/openai-compatible.provider';
import { OpenAIStrategy } from '../../../src/providers/strategies/openai.strategy';
import type OpenAI from 'openai';

// Simulate OpenAI APIError with status code (matches the real SDK shape)
class FakeAPIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

const mockGenerate = mock(() =>
  Promise.resolve({ created: 1_700_000_000, data: [{ b64_json: 'bm9ja0ltYWdl' }] }),
);
const mockEdit = mock(() =>
  Promise.resolve({ created: 1_700_000_000, data: [{ b64_json: 'ZWRpdA==' }] }),
);
const mockModelsList = mock(() => Promise.resolve({ object: 'list', data: [] }));

function makeProvider() {
  const mockClient = {
    images: { generate: mockGenerate, edit: mockEdit },
    models: { list: mockModelsList },
  } as unknown as OpenAI;
  return new OpenAICompatibleProvider(mockClient, new OpenAIStrategy());
}

describe('OpenAICompatibleProvider (OpenAI) — HTTP Integration', () => {
  beforeEach(() => {
    mockGenerate.mockClear();
    mockEdit.mockClear();
    mockModelsList.mockClear();
  });

  describe('generate()', () => {
    it('should call images.generate and return ImageResult[]', async () => {
      const provider = makeProvider();
      const results = await provider.generate({ prompt: 'a cat', model: 'gpt-image-1' });
      expect(results).toHaveLength(1);
      expect(results[0].b64_json).toBe('bm9ja0ltYWdl');
      expect(results[0].model).toBe('gpt-image-1');
      expect(results[0].created).toBe(1_700_000_000);
    });

    it('should return multiple images when n > 1', async () => {
      mockGenerate.mockResolvedValueOnce({
        created: 1_700_000_000,
        data: [{ b64_json: 'aW1nMQ==' }, { b64_json: 'aW1nMg==' }],
      });
      const results = await makeProvider().generate({ prompt: 'a cat', model: 'gpt-image-1', n: 2 });
      expect(results).toHaveLength(2);
    });

    it('should throw rate-limit error on 429 response', async () => {
      mockGenerate.mockRejectedValueOnce(new FakeAPIError('Rate limit exceeded', 429));
      await expect(makeProvider().generate({ prompt: 'a cat', model: 'gpt-image-1' }))
        .rejects.toThrow(/rate limit/i);
    });

    it('should throw auth error on 401 response', async () => {
      mockGenerate.mockRejectedValueOnce(new FakeAPIError('Incorrect API key provided', 401));
      await expect(makeProvider().generate({ prompt: 'a cat', model: 'gpt-image-1' }))
        .rejects.toThrow(/authentication/i);
    });

    it('should include revised_prompt from dall-e-3 response', async () => {
      mockGenerate.mockResolvedValueOnce({
        created: 1_700_000_000,
        data: [{ b64_json: 'ZGFsbGUz', revised_prompt: 'A fluffy tabby cat' }],
      });
      const results = await makeProvider().generate({ prompt: 'cat', model: 'dall-e-3' });
      expect(results[0].revised_prompt).toBe('A fluffy tabby cat');
    });
  });

  describe('validate()', () => {
    it('should return valid=true when models.list succeeds', async () => {
      const result = await makeProvider().validate();
      expect(result.valid).toBe(true);
      expect(result.provider).toBe('openai');
    });

    it('should return valid=false on error from models.list', async () => {
      mockModelsList.mockRejectedValueOnce(new FakeAPIError('Invalid API key', 401));
      const result = await makeProvider().validate();
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
