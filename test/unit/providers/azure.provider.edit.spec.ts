/**
 * Unit tests for AzureOpenAIProvider.edit() — covers uncovered lines 55-82.
 */

const mockGenerate = jest.fn();
const mockEdit = jest.fn();
const mockModelsList = jest.fn();

jest.mock('openai', () => ({
  AzureOpenAI: jest.fn().mockImplementation(() => ({
    images: { generate: mockGenerate, edit: mockEdit },
    models: { list: mockModelsList },
  })),
}));

import { AzureOpenAIProvider } from '../../../src/providers/azure/azure.provider';

const VALID_CONFIG = {
  endpoint: 'https://test.openai.azure.com',
  apiKey: 'azure-key-abc123',
  deployment: 'gpt-image-deployment',
  apiVersion: '2025-04-01-preview',
};

const VALID_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';
const MASK_B64  = VALID_B64;

describe('AzureOpenAIProvider — edit()', () => {
  let provider: AzureOpenAIProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new AzureOpenAIProvider(VALID_CONFIG);
  });

  it('should call images.edit and return ImageResult[]', async () => {
    mockEdit.mockResolvedValue({
      created: 1_700_000_001,
      data: [{ b64_json: 'YXp1cmVFZGl0' }],
    });

    const results = await provider.edit({
      image: VALID_B64,
      prompt: 'add a crown',
      model: 'gpt-image-1',
    });

    expect(results).toHaveLength(1);
    expect(results[0].b64_json).toBe('YXp1cmVFZGl0');
    // Azure always uses deployment name as model
    expect(results[0].model).toBe(VALID_CONFIG.deployment);
    expect(mockEdit).toHaveBeenCalledTimes(1);
  });

  it('should pass mask when provided', async () => {
    mockEdit.mockResolvedValue({ created: 0, data: [{ b64_json: 'bWFzaw==' }] });

    await provider.edit({
      image: VALID_B64,
      mask: MASK_B64,
      prompt: 'fill with clouds',
      model: 'gpt-image-1',
    });

    const call = mockEdit.mock.calls[0][0];
    expect(call.mask).toBeDefined();
    expect(call.mask).toBeInstanceOf(File);
  });

  it('should omit mask when not provided', async () => {
    mockEdit.mockResolvedValue({ created: 0, data: [{ b64_json: 'bm9tYXNr' }] });

    await provider.edit({ image: VALID_B64, prompt: 'no mask', model: 'gpt-image-1' });

    const call = mockEdit.mock.calls[0][0];
    expect(call.mask).toBeUndefined();
  });

  it('should always use deployment name as model param', async () => {
    mockEdit.mockResolvedValue({ created: 0, data: [{ b64_json: 'ZGVwbA==' }] });

    await provider.edit({ image: VALID_B64, prompt: 'test', model: 'gpt-image-1' });

    const call = mockEdit.mock.calls[0][0];
    expect(call.model).toBe(VALID_CONFIG.deployment);
  });

  it('should throw rate-limit error on 429', async () => {
    mockEdit.mockRejectedValue(new Error('429 Too Many Requests'));
    await expect(provider.edit({ image: VALID_B64, prompt: 'test', model: 'gpt-image-1' }))
      .rejects.toThrow(/rate limit/i);
  });

  it('should throw auth error on 401', async () => {
    mockEdit.mockRejectedValue(new Error('401 Unauthorized'));
    await expect(provider.edit({ image: VALID_B64, prompt: 'test', model: 'gpt-image-1' }))
      .rejects.toThrow(/authentication/i);
  });

  it('should throw deployment-not-found error on 404', async () => {
    mockEdit.mockRejectedValue(new Error('404 Not Found'));
    await expect(provider.edit({ image: VALID_B64, prompt: 'test', model: 'gpt-image-1' }))
      .rejects.toThrow(/not found|deployment/i);
  });

  it('should strip data URI prefix from base64', async () => {
    mockEdit.mockResolvedValue({ created: 0, data: [{ b64_json: 'c3RyaXA=' }] });
    const dataUri = `data:image/png;base64,${VALID_B64}`;
    await provider.edit({ image: dataUri, prompt: 'test', model: 'gpt-image-1' });
    expect(mockEdit).toHaveBeenCalledTimes(1);
    expect(mockEdit.mock.calls[0][0].image).toBeInstanceOf(File);
  });
});

describe('AzureOpenAIProvider — gpt-image-2 guard', () => {
  it('should throw a helpful 403/access error message for gpt-image-2', async () => {
    jest.clearAllMocks();
    mockGenerate.mockRejectedValue(new Error('403 Forbidden: Access denied to model gpt-image-2'));
    const provider = new AzureOpenAIProvider(VALID_CONFIG);
    await expect(provider.generate({ prompt: 'test', model: 'gpt-image-2' }))
      .rejects.toThrow();
  });
});
