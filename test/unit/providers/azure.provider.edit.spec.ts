import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OpenAICompatibleProvider } from '../../../src/providers/openai-compatible.provider';
import { AzureStrategy } from '../../../src/providers/strategies/azure.strategy';
import type OpenAI from 'openai';

const mockEdit = mock(() => Promise.resolve({ data: [{ b64_json: 'azure-edit-b64' }], created: 2000 }));

function makeProvider(deployment = 'my-deployment') {
  const mockClient = {
    images: { edit: mockEdit },
    models: { list: mock(() => Promise.resolve({ data: [] })) },
  } as unknown as OpenAI;
  return new OpenAICompatibleProvider(mockClient, new AzureStrategy(deployment));
}

const VALID_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('OpenAICompatibleProvider — Azure edit()', () => {
  beforeEach(() => { mockEdit.mockClear(); });

  it('should call images.edit and return ImageResult[]', async () => {
    const results = await makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' });
    expect(results[0].b64_json).toBe('azure-edit-b64');
    expect(mockEdit).toHaveBeenCalledTimes(1);
  });

  it('should pass mask when provided', async () => {
    await makeProvider().edit({ image: VALID_B64, mask: VALID_B64, prompt: 'edit', model: 'gpt-image-1' });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['mask']).toBeDefined();
  });

  it('should omit mask when not provided', async () => {
    await makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['mask']).toBeUndefined();
  });

  it('should always use deployment name as model param', async () => {
    await makeProvider('prod-dep').edit({ image: VALID_B64, prompt: 'edit', model: 'ignored' });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['model']).toBe('prod-dep');
  });

  it('should pass only common params — no GPT-image extras', async () => {
    await makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1', n: 2, size: '512x512' });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['n']).toBe(2);
    expect(call['size']).toBe('512x512');
    expect(call['output_format']).toBeUndefined();
  });

  it('should throw rate-limit error on 429', async () => {
    mockEdit.mockRejectedValueOnce(new Error('429 Too Many Requests'));
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' })).rejects.toThrow('Rate limit exceeded (Azure)');
  });

  it('should throw auth error on 401', async () => {
    mockEdit.mockRejectedValueOnce(new Error('401 Unauthorized'));
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' })).rejects.toThrow('Authentication failed');
  });

  it('should throw deployment-not-found error on 404', async () => {
    mockEdit.mockRejectedValueOnce(new Error('404 Not Found'));
    await expect(makeProvider('my-dep').edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' })).rejects.toThrow('my-dep');
  });

  it('should strip data URI prefix from base64', async () => {
    await makeProvider().edit({ image: `data:image/png;base64,${VALID_B64}`, prompt: 'edit', model: 'gpt-image-1' });
    expect(mockEdit).toHaveBeenCalledTimes(1);
  });

  it('should throw a helpful 403/access error with registration link for gpt-image-1.x', async () => {
    mockEdit.mockRejectedValueOnce(new Error('403 Forbidden: Access denied to model gpt-image-1'));
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' })).rejects.toThrow('aka.ms/oai/gptimage1access');
  });
});
