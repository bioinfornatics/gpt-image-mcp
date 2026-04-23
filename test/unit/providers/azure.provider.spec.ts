import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OpenAICompatibleProvider } from '../../../src/providers/openai-compatible.provider';
import { AzureStrategy } from '../../../src/providers/strategies/azure.strategy';
import type OpenAI from 'openai';

const mockGenerate = mock(() => Promise.resolve({ data: [{ b64_json: 'azure-b64', revised_prompt: undefined }], created: 2000 }));
const mockModelsList = mock(() => Promise.resolve({ data: [] }));

function makeProvider(deployment = 'my-deployment') {
  const mockClient = {
    images: { generate: mockGenerate },
    models: { list: mockModelsList },
  } as unknown as OpenAI;
  return new OpenAICompatibleProvider(mockClient, new AzureStrategy(deployment));
}

describe('OpenAICompatibleProvider (Azure strategy)', () => {
  beforeEach(() => {
    mockGenerate.mockClear();
    mockModelsList.mockClear();
  });

  describe('name', () => {
    it('should be "azure"', () => {
      expect(makeProvider().name).toBe('azure');
    });
  });

  describe('generate()', () => {
    it('should return ImageResult[] on success', async () => {
      const results = await makeProvider().generate({ prompt: 'a cat', model: 'gpt-image-1', n: 1 });
      expect(results[0].b64_json).toBe('azure-b64');
    });

    it('should always use the deployment name as model', async () => {
      await makeProvider('prod-deployment').generate({ prompt: 'test', model: 'ignored-model' });
      const call = mockGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(call['model']).toBe('prod-deployment');
    });

    it('should pass model, prompt, n, size, quality — no GPT-image-specific extras', async () => {
      await makeProvider().generate({ prompt: 'test', model: 'gpt-image-1', n: 2, size: '1024x1024', quality: 'high' });
      const call = mockGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(call['prompt']).toBe('test');
      expect(call['n']).toBe(2);
      expect(call['size']).toBe('1024x1024');
      expect(call['quality']).toBe('high');
      // Azure strategy does NOT pass GPT-image-specific params
      expect(call['background']).toBeUndefined();
      expect(call['output_format']).toBeUndefined();
      expect(call['moderation']).toBeUndefined();
    });

    it('should NOT send response_format (Azure ignores it and may reject it)', async () => {
      await makeProvider().generate({ prompt: 'test', model: 'gpt-image-1' });
      const call = mockGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(call['response_format']).toBeUndefined();
    });

    it('should throw rate-limit error on 429 response', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('429 Too Many Requests'));
      await expect(makeProvider().generate({ prompt: 'test', model: 'gpt-image-1' })).rejects.toThrow('Rate limit exceeded (Azure)');
    });

    it('should throw auth error on 401 response', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('401 Unauthorized'));
      await expect(makeProvider().generate({ prompt: 'test', model: 'gpt-image-1' })).rejects.toThrow('Authentication failed');
    });

    it('should throw deployment not found error on 404', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('404 Not Found'));
      await expect(makeProvider('my-dep').generate({ prompt: 'test', model: 'gpt-image-1' })).rejects.toThrow('my-dep');
    });

    it('should throw a helpful 403/access error for gpt-image-2', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('403 Forbidden: Access denied to model gpt-image-2'));
      await expect(makeProvider().generate({ prompt: 'test', model: 'gpt-image-2' })).rejects.toThrow('Azure portal');
    });
  });

  describe('variation()', () => {
    it('should always throw — Azure does not support variation', async () => {
      await expect(makeProvider().variation({ image: 'img' })).rejects.toThrow('azure');
    });
  });

  describe('validate()', () => {
    it('should return valid=true when models list succeeds', async () => {
      const result = await makeProvider().validate();
      expect(result.valid).toBe(true);
      expect(result.provider).toBe('azure');
    });

    it('should return valid=false on failure', async () => {
      mockModelsList.mockRejectedValueOnce(new Error('network error'));
      const result = await makeProvider().validate();
      expect(result.valid).toBe(false);
    });
  });
});
