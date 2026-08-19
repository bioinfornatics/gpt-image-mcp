import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { CustomStrategy } from '../../../src/providers/strategies/custom.strategy';
import { OpenAICompatibleProvider } from '../../../src/providers/openai-compatible.provider';
import type OpenAI from 'openai';

const VALID_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('CustomStrategy', () => {
  let strategy: CustomStrategy;

  beforeEach(() => {
    strategy = new CustomStrategy();
  });

  describe('properties', () => {
    it('should have name "custom"', () => {
      expect(strategy.name).toBe('custom');
    });

    it('should have supportsVariation = false', () => {
      expect(strategy.supportsVariation).toBe(false);
    });

    it('should have logPrefix "[Custom]"', () => {
      expect(strategy.logPrefix).toBe('[Custom]');
    });
  });

  describe('resolveModel()', () => {
    it('should return the model from params when provided', () => {
      expect(strategy.resolveModel({ model: 'my-custom-model' })).toBe('my-custom-model');
    });

    it('should return "custom" as default when model is undefined', () => {
      expect(strategy.resolveModel({ model: undefined as unknown as string })).toBe('custom');
    });

    it('should return "custom" as default when model is empty string', () => {
      expect(strategy.resolveModel({ model: '' })).toBe('custom');
    });
  });

  describe('buildGenerateExtras()', () => {
    it('should return only response_format for dall-e models', () => {
      const params = {
        prompt: 'a cat',
        model: 'dall-e-3',
        background: 'transparent' as const,
        output_format: 'png' as const,
      };
      const extras = strategy.buildGenerateExtras(params, 'dall-e-3');
      expect(extras).toEqual({ response_format: 'b64_json' });
    });

    it('should omit response_format for GPT-image-compatible custom models', () => {
      const params = {
        prompt: 'a cat',
        model: 'gpt-image-2',
        background: 'transparent' as const,
        output_format: 'webp' as const,
        output_compression: 80,
      };
      const extras = strategy.buildGenerateExtras(params, 'gpt-image-2');
      expect(extras).toEqual({
        background: 'transparent',
        output_format: 'webp',
        output_compression: 80,
      });
      expect(extras).not.toHaveProperty('response_format');
    });

    it('should omit undefined optional fields and response_format', () => {
      const params = { prompt: 'a cat', model: 'gpt-image-2' };
      const extras = strategy.buildGenerateExtras(params, 'gpt-image-2');
      expect(extras).toEqual({});
      expect(extras).not.toHaveProperty('response_format');
      expect(extras).not.toHaveProperty('background');
      expect(extras).not.toHaveProperty('output_format');
      expect(extras).not.toHaveProperty('output_compression');
    });
  });

  describe('buildEditExtras()', () => {
    it('should omit response_format for GPT-image-compatible custom models', () => {
      const params = { image: 'base64', prompt: 'edit this', model: 'custom' };
      const extras = strategy.buildEditExtras(params);
      expect(extras).not.toHaveProperty('response_format');
    });

    it('should omit response_format for a GPT image model name too', () => {
      const params = { image: 'base64', prompt: 'edit this', model: 'gpt-image-2' };
      const extras = strategy.buildEditExtras(params);
      expect(extras).not.toHaveProperty('response_format');
    });

    it('should request response_format: b64_json for dall-e edit models', () => {
      const params = { image: 'base64', prompt: 'edit this', model: 'dall-e-2' };
      const extras = strategy.buildEditExtras(params);
      expect(extras['response_format']).toBe('b64_json');
    });

    it('should include quality when provided and not "auto"', () => {
      const params = { image: 'base64', prompt: 'edit this', model: 'custom', quality: 'high' };
      const extras = strategy.buildEditExtras(params);
      expect(extras['quality']).toBe('high');
    });

    it('should not include quality when it is "auto"', () => {
      const params = { image: 'base64', prompt: 'edit this', model: 'custom', quality: 'auto' };
      const extras = strategy.buildEditExtras(params);
      expect(extras).not.toHaveProperty('quality');
    });

    it('should include output_format when provided', () => {
      const params = {
        image: 'base64',
        prompt: 'edit this',
        model: 'custom',
        output_format: 'jpeg' as const,
      };
      const extras = strategy.buildEditExtras(params);
      expect(extras['output_format']).toBe('jpeg');
    });

    it('should not include output_format when not provided', () => {
      const params = { image: 'base64', prompt: 'edit this', model: 'custom' };
      const extras = strategy.buildEditExtras(params);
      expect(extras).not.toHaveProperty('output_format');
    });
  });

  describe('normalizeError()', () => {
    it('should return auth error for 401 in message', () => {
      const err = new Error('401 Unauthorized');
      const result = strategy.normalizeError(err);
      expect(result.message).toBe('Authentication failed (Custom): check IMAGE_API_KEY.');
    });

    it('should return auth error for "unauthorized" keyword', () => {
      const err = new Error('unauthorized request');
      const result = strategy.normalizeError(err);
      expect(result.message).toBe('Authentication failed (Custom): check IMAGE_API_KEY.');
    });

    it('should return rate limit error for 429', () => {
      const err = new Error('429 Too Many Requests');
      const result = strategy.normalizeError(err);
      expect(result.message).toContain('Rate limit exceeded (Custom)');
    });

    it('should return rate limit error for "rate limit" keyword', () => {
      const err = new Error('rate limit exceeded');
      const result = strategy.normalizeError(err);
      expect(result.message).toContain('Rate limit exceeded (Custom)');
    });

    it('should return generic Custom error for other errors', () => {
      const err = new Error('Connection refused');
      const result = strategy.normalizeError(err);
      expect(result.message).toContain('Custom OpenAI-compatible endpoint error');
      expect(result.message).toContain('Connection refused');
    });

    it('should handle non-Error thrown values', () => {
      const result = strategy.normalizeError('plain string error');
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('plain string error');
    });

    it('should mask secrets in error messages', () => {
      const err = new Error('sk-my-secret-custom-key-that-is-long-enough-to-mask failed');
      const result = strategy.normalizeError(err);
      expect(result.message).not.toContain('sk-my-secret-custom-key');
    });
  });
});

describe('OpenAICompatibleProvider (Custom strategy) — response format negotiation & payload safety', () => {
  const mockGenerate = mock(() => Promise.resolve({ data: [{ b64_json: VALID_B64 }], created: 1000 }));
  const mockEdit = mock(() => Promise.resolve({ data: [{ b64_json: VALID_B64 }], created: 1000 }));

  function makeProvider() {
    const mockClient = {
      images: { generate: mockGenerate, edit: mockEdit },
      models: { list: mock(() => Promise.resolve({ data: [] })) },
    } as unknown as OpenAI;
    return new OpenAICompatibleProvider(mockClient, new CustomStrategy());
  }

  beforeEach(() => {
    mockGenerate.mockClear();
    mockEdit.mockClear();
  });

  describe('generate() — response_format negotiation', () => {
    it('omits response_format for a GPT Image-compatible custom endpoint', async () => {
      await makeProvider().generate({ prompt: 'a cat', model: 'gpt-image-2', n: 1 });
      const call = mockGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(call['response_format']).toBeUndefined();
    });

    it('requests b64_json for a legacy/DALL-E-compatible custom endpoint', async () => {
      await makeProvider().generate({ prompt: 'a cat', model: 'dall-e-3', n: 1 });
      const call = mockGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(call['response_format']).toBe('b64_json');
    });
  });

  describe('edit() — response_format negotiation', () => {
    it('omits response_format for a GPT Image-compatible custom endpoint', async () => {
      await makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-2' });
      const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
      expect(call['response_format']).toBeUndefined();
    });

    it('requests b64_json for a legacy/DALL-E-compatible custom endpoint', async () => {
      await makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'dall-e-2' });
      const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
      expect(call['response_format']).toBe('b64_json');
    });
  });

  describe('response payload safety — no implicit downloads / SSRF', () => {
    it('fails explicitly on a URL-only generate response instead of downloading it', async () => {
      mockGenerate.mockResolvedValueOnce({ data: [{ url: 'http://169.254.169.254/latest/meta-data/' }], created: 1000 });
      await expect(makeProvider().generate({ prompt: 'cat', model: 'gpt-image-2' })).rejects.toThrow(
        /URL instead of inline image data/,
      );
    });

    it('fails explicitly on a missing/empty generate payload', async () => {
      mockGenerate.mockResolvedValueOnce({ data: [{}], created: 1000 });
      await expect(makeProvider().generate({ prompt: 'cat', model: 'gpt-image-2' })).rejects.toThrow(
        /empty image payload/,
      );
    });

    it('fails explicitly on a corrupt (non-image) base64 generate payload', async () => {
      mockGenerate.mockResolvedValueOnce({
        data: [{ b64_json: Buffer.from('not an image').toString('base64') }],
        created: 1000,
      });
      await expect(makeProvider().generate({ prompt: 'cat', model: 'gpt-image-2' })).rejects.toThrow(
        /unsupported or corrupt image data/i,
      );
    });

    it('fails explicitly on a URL-only edit response instead of downloading it', async () => {
      mockEdit.mockResolvedValueOnce({ data: [{ url: 'https://example.test/image.png' }], created: 1000 });
      await expect(
        makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-2' }),
      ).rejects.toThrow(/URL instead of inline image data/);
    });

    it('fails explicitly when the generate response has no data at all', async () => {
      mockGenerate.mockResolvedValueOnce({ data: [], created: 1000 });
      await expect(makeProvider().generate({ prompt: 'cat', model: 'gpt-image-2' })).rejects.toThrow(
        /no image data/i,
      );
    });
  });
});
