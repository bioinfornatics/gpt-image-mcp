/**
 * Unit tests for OpenAIProvider.edit() and OpenAIProvider.variation().
 * Covers the uncovered lines in openai.provider.ts.
 */

const mockGenerate = jest.fn();
const mockEdit = jest.fn();
const mockCreateVariation = jest.fn();
const mockModelsList = jest.fn();

class FakeAPIError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

jest.mock('openai', () => ({
  default: jest.fn().mockImplementation(() => ({
    images: {
      generate: mockGenerate,
      edit: mockEdit,
      createVariation: mockCreateVariation,
    },
    models: { list: mockModelsList },
  })),
  APIError: FakeAPIError,
}));

import { OpenAIProvider } from '../../../src/providers/openai/openai.provider';

const VALID_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';
const MASK_B64  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';

describe('OpenAIProvider — edit()', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new OpenAIProvider({ apiKey: 'sk-test-edit' });
  });

  it('should call images.edit and return ImageResult[]', async () => {
    mockEdit.mockResolvedValue({
      created: 1_700_000_001,
      data: [{ b64_json: 'ZWRpdGVk' }],
    });

    const results = await provider.edit({
      image: VALID_B64,
      prompt: 'add a hat',
      model: 'gpt-image-1',
    });

    expect(results).toHaveLength(1);
    expect(results[0].b64_json).toBe('ZWRpdGVk');
    expect(results[0].model).toBe('gpt-image-1');
    expect(mockEdit).toHaveBeenCalledTimes(1);
  });

  it('should pass mask to images.edit when provided', async () => {
    mockEdit.mockResolvedValue({ created: 0, data: [{ b64_json: 'bWFza2Vk' }] });

    await provider.edit({
      image: VALID_B64,
      mask: MASK_B64,
      prompt: 'fill the masked area with sky',
      model: 'gpt-image-1',
    });

    const call = mockEdit.mock.calls[0][0];
    expect(call.mask).toBeDefined();
    expect(call.mask).toBeInstanceOf(File);
  });

  it('should not pass mask to images.edit when not provided', async () => {
    mockEdit.mockResolvedValue({ created: 0, data: [{ b64_json: 'bm9tYXNr' }] });

    await provider.edit({
      image: VALID_B64,
      prompt: 'no mask',
      model: 'gpt-image-1',
    });

    const call = mockEdit.mock.calls[0][0];
    expect(call.mask).toBeUndefined();
  });

  it('should pass n and size parameters through', async () => {
    mockEdit.mockResolvedValue({ created: 0, data: [{ b64_json: 'cGFyYW1z' }] });

    await provider.edit({
      image: VALID_B64,
      prompt: 'test',
      model: 'gpt-image-1',
      n: 2,
      size: '1024x1024',
    });

    const call = mockEdit.mock.calls[0][0];
    expect(call.n).toBe(2);
    expect(call.size).toBe('1024x1024');
  });

  it('should strip data URI prefix from base64 input', async () => {
    mockEdit.mockResolvedValue({ created: 0, data: [{ b64_json: 'c3RyaXA=' }] });

    const dataUri = `data:image/png;base64,${VALID_B64}`;
    await provider.edit({ image: dataUri, prompt: 'test', model: 'gpt-image-1' });

    // Should not throw — File created successfully from stripped b64
    expect(mockEdit).toHaveBeenCalledTimes(1);
    const call = mockEdit.mock.calls[0][0];
    expect(call.image).toBeInstanceOf(File);
  });

  it('should throw rate-limit error on 429', async () => {
    mockEdit.mockRejectedValue(new FakeAPIError('rate limited', 429));
    await expect(provider.edit({ image: VALID_B64, prompt: 'test', model: 'gpt-image-1' }))
      .rejects.toThrow(/rate limit/i);
  });

  it('should throw auth error on 401', async () => {
    mockEdit.mockRejectedValue(new FakeAPIError('unauthorized', 401));
    await expect(provider.edit({ image: VALID_B64, prompt: 'test', model: 'gpt-image-1' }))
      .rejects.toThrow(/authentication/i);
  });

  it('should throw not-found error on 404', async () => {
    mockEdit.mockRejectedValue(new FakeAPIError('not found', 404));
    await expect(provider.edit({ image: VALID_B64, prompt: 'test', model: 'gpt-image-1' }))
      .rejects.toThrow(/not found/i);
  });

  it('should throw bad-request error on 400', async () => {
    mockEdit.mockRejectedValue(new FakeAPIError('bad request: invalid image', 400));
    await expect(provider.edit({ image: VALID_B64, prompt: 'test', model: 'gpt-image-1' }))
      .rejects.toThrow(/bad request/i);
  });
});

describe('OpenAIProvider — variation()', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new OpenAIProvider({ apiKey: 'sk-test-variation' });
  });

  it('should call images.createVariation and return ImageResult[]', async () => {
    mockCreateVariation.mockResolvedValue({
      created: 1_700_000_002,
      data: [{ b64_json: 'dmFyaWF0aW9u' }],
    });

    const results = await provider.variation({ image: VALID_B64 });

    expect(results).toHaveLength(1);
    expect(results[0].b64_json).toBe('dmFyaWF0aW9u');
    expect(results[0].model).toBe('dall-e-2');
    expect(mockCreateVariation).toHaveBeenCalledTimes(1);
  });

  it('should pass n and size to createVariation', async () => {
    mockCreateVariation.mockResolvedValue({ created: 0, data: [{ b64_json: 'bg==' }] });

    await provider.variation({ image: VALID_B64, n: 3, size: '512x512' });

    const call = mockCreateVariation.mock.calls[0][0];
    expect(call.n).toBe(3);
    expect(call.size).toBe('512x512');
  });

  it('should always set response_format to b64_json', async () => {
    mockCreateVariation.mockResolvedValue({ created: 0, data: [{ b64_json: 'Yg==' }] });
    await provider.variation({ image: VALID_B64 });
    expect(mockCreateVariation.mock.calls[0][0].response_format).toBe('b64_json');
  });

  it('should return multiple variations when n > 1', async () => {
    mockCreateVariation.mockResolvedValue({
      created: 0,
      data: [{ b64_json: 'djE=' }, { b64_json: 'djI=' }],
    });

    const results = await provider.variation({ image: VALID_B64, n: 2 });
    expect(results).toHaveLength(2);
    expect(results.every(r => r.model === 'dall-e-2')).toBe(true);
  });

  it('should throw on API error', async () => {
    mockCreateVariation.mockRejectedValue(new FakeAPIError('only square images', 400));
    await expect(provider.variation({ image: VALID_B64 }))
      .rejects.toThrow(/bad request/i);
  });
});
