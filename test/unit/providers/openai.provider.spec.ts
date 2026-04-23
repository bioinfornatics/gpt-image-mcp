import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OpenAICompatibleProvider } from '../../../src/providers/openai-compatible.provider';
import { OpenAIStrategy } from '../../../src/providers/strategies/openai.strategy';
import type OpenAI from 'openai';

const mockGenerate = mock(() => Promise.resolve({ data: [{ b64_json: 'abc123', revised_prompt: undefined }], created: 1000 }));
const mockModelsList = mock(() => Promise.resolve({ data: [] }));

function makeProvider() {
  const mockClient = {
    images: { generate: mockGenerate },
    models: { list: mockModelsList },
  } as unknown as OpenAI;
  return new OpenAICompatibleProvider(mockClient, new OpenAIStrategy());
}

describe('OpenAICompatibleProvider (OpenAI strategy)', () => {
  beforeEach(() => {
    mockGenerate.mockClear();
    mockModelsList.mockClear();
  });

  describe('name', () => {
    it('should be "openai"', () => {
      expect(makeProvider().name).toBe('openai');
    });
  });

  describe('generate()', () => {
    it('should return ImageResult[] on success', async () => {
      const provider = makeProvider();
      const results = await provider.generate({ prompt: 'a cat', model: 'gpt-image-1', n: 1 });
      expect(results).toHaveLength(1);
      expect(results[0].b64_json).toBe('abc123');
      expect(results[0].model).toBe('gpt-image-1');
    });

    it('should pass response_format:b64_json for dall-e models', async () => {
      const provider = makeProvider();
      await provider.generate({ prompt: 'a cat', model: 'dall-e-3', n: 1 });
      const call = mockGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(call['response_format']).toBe('b64_json');
    });

    it('should NOT pass response_format for gpt-image models', async () => {
      const provider = makeProvider();
      await provider.generate({ prompt: 'a cat', model: 'gpt-image-1', n: 1 });
      const call = mockGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(call['response_format']).toBeUndefined();
    });

    it('should pass GPT-image-specific extras for gpt-image models', async () => {
      const provider = makeProvider();
      await provider.generate({ prompt: 'a cat', model: 'gpt-image-1', n: 1, background: 'transparent', output_format: 'webp', moderation: 'low' });
      const call = mockGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(call['background']).toBe('transparent');
      expect(call['output_format']).toBe('webp');
      expect(call['moderation']).toBe('low');
    });

    it('should throw rate-limit error on 429', async () => {
      const FakeError = class extends Error { status = 429; };
      mockGenerate.mockRejectedValueOnce(Object.assign(new FakeError('rate limited'), { status: 429 }));
      const provider = makeProvider();
      await expect(provider.generate({ prompt: 'test', model: 'gpt-image-1' })).rejects.toThrow('Rate limit exceeded');
    });

    it('should throw auth error on 401', async () => {
      const FakeError = class extends Error { status = 401; };
      mockGenerate.mockRejectedValueOnce(Object.assign(new FakeError('unauthorized'), { status: 401 }));
      const provider = makeProvider();
      await expect(provider.generate({ prompt: 'test', model: 'gpt-image-1' })).rejects.toThrow('Authentication failed');
    });

    it('should throw not-found error on 404', async () => {
      const FakeError = class extends Error { status = 404; };
      mockGenerate.mockRejectedValueOnce(Object.assign(new FakeError('not found'), { status: 404 }));
      const provider = makeProvider();
      await expect(provider.generate({ prompt: 'test', model: 'gpt-image-1' })).rejects.toThrow('not found');
    });

    it('should NEVER log the API key', async () => {
      const FakeError = class extends Error { status = 500; };
      const fakeKey = 'sk-real-secret-key-abc1234567890abcdefghij';
      mockGenerate.mockRejectedValueOnce(Object.assign(new FakeError(`some error with ${fakeKey}`), { status: 500 }));
      const provider = makeProvider();
      try {
        await provider.generate({ prompt: 'test', model: 'gpt-image-1' });
      } catch (err) {
        expect(String(err)).not.toContain(fakeKey);
      }
    });
  });

  describe('validate()', () => {
    it('should return valid=true when models list succeeds', async () => {
      const result = await makeProvider().validate();
      expect(result.valid).toBe(true);
      expect(result.provider).toBe('openai');
    });

    it('should return valid=false when API call fails', async () => {
      mockModelsList.mockRejectedValueOnce(new Error('network error'));
      const result = await makeProvider().validate();
      expect(result.valid).toBe(false);
    });

    it('should not expose API key in validation error', async () => {
      const fakeKey = 'sk-real-key-abc1234567890abcdefghijklmn';
      mockModelsList.mockRejectedValueOnce(new Error(`auth failed with ${fakeKey}`));
      const result = await makeProvider().validate();
      expect(result.error).not.toContain(fakeKey);
    });
  });
});
