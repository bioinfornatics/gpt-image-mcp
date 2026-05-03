import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OpenAICompatibleProvider } from '../../../src/providers/openai-compatible.provider';
import { OpenAIStrategy } from '../../../src/providers/strategies/openai.strategy';
import type OpenAI from 'openai';

const mockEdit = mock(() => Promise.resolve({ data: [{ b64_json: 'edit-b64' }], created: 1000 }));
const mockCreateVariation = mock(() => Promise.resolve({ data: [{ b64_json: 'var-b64' }], created: 1000 }));

function makeProvider() {
  const mockClient = {
    images: { edit: mockEdit, createVariation: mockCreateVariation },
    models: { list: mock(() => Promise.resolve({ data: [] })) },
  } as unknown as OpenAI;
  return new OpenAICompatibleProvider(mockClient, new OpenAIStrategy());
}

const VALID_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('OpenAICompatibleProvider — edit()', () => {
  beforeEach(() => { mockEdit.mockClear(); });

  it('should call images.edit and return ImageResult[]', async () => {
    const results = await makeProvider().edit({ image: VALID_B64, prompt: 'add rainbow', model: 'gpt-image-1' });
    expect(results[0].b64_json).toBe('edit-b64');
    expect(mockEdit).toHaveBeenCalledTimes(1);
  });

  it('should pass mask to images.edit when provided', async () => {
    await makeProvider().edit({ image: VALID_B64, mask: VALID_B64, prompt: 'edit', model: 'gpt-image-1' });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['mask']).toBeDefined();
  });

  it('should not pass mask to images.edit when not provided', async () => {
    await makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['mask']).toBeUndefined();
  });

  it('should pass n and size parameters through', async () => {
    await makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1', n: 2, size: '512x512' });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['n']).toBe(2);
    expect(call['size']).toBe('512x512');
  });

  it('should strip data URI prefix from base64 input', async () => {
    await makeProvider().edit({ image: `data:image/png;base64,${VALID_B64}`, prompt: 'edit', model: 'gpt-image-1' });
    expect(mockEdit).toHaveBeenCalledTimes(1);
  });

  it('should always set response_format to b64_json', async () => {
    await makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['response_format']).toBe('b64_json');
  });

  it('should throw rate-limit error on 429', async () => {
    mockEdit.mockRejectedValueOnce(Object.assign(new Error('rate limited'), { status: 429 }));
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' })).rejects.toThrow('Rate limit exceeded');
  });

  it('should throw auth error on 401', async () => {
    mockEdit.mockRejectedValueOnce(Object.assign(new Error('unauthorized'), { status: 401 }));
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' })).rejects.toThrow('Authentication failed');
  });

  it('should throw not-found error on 404', async () => {
    mockEdit.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }));
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' })).rejects.toThrow('not found');
  });

  it('should throw bad-request error on 400', async () => {
    mockEdit.mockRejectedValueOnce(Object.assign(new Error('invalid image'), { status: 400 }));
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' })).rejects.toThrow('Bad request');
  });
});

describe('OpenAICompatibleProvider — edit() — multi-image', () => {
  beforeEach(() => { mockEdit.mockClear(); });

  it('should pass File[] to images.edit when images[] provided', async () => {
    await makeProvider().edit({ images: [VALID_B64, VALID_B64], prompt: 'compose', model: 'gpt-image-1' });
    expect(mockEdit).toHaveBeenCalledTimes(1);
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    // image should be an array of File objects
    expect(Array.isArray(call['image'])).toBe(true);
    const imageArr = call['image'] as File[];
    expect(imageArr).toHaveLength(2);
    expect(imageArr[0]).toBeInstanceOf(File);
    expect(imageArr[1]).toBeInstanceOf(File);
  });

  it('should pass single File when only image provided (backward compat)', async () => {
    await makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(Array.isArray(call['image'])).toBe(false);
    expect(call['image']).toBeInstanceOf(File);
  });

  it('should throw when neither image nor images provided', async () => {
    await expect(
      makeProvider().edit({ prompt: 'edit', model: 'gpt-image-1' }),
    ).rejects.toThrow('Either image or images must be provided to edit()');
  });

  it('should NOT include input_fidelity when model is gpt-image-2', async () => {
    await makeProvider().edit({
      image: VALID_B64,
      prompt: 'edit',
      model: 'gpt-image-2',
      input_fidelity: 'high',
    });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['input_fidelity']).toBeUndefined();
  });

  it('should include input_fidelity: "low" when model is gpt-image-1 and input_fidelity provided', async () => {
    await makeProvider().edit({
      image: VALID_B64,
      prompt: 'edit',
      model: 'gpt-image-1',
      input_fidelity: 'low',
    });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['input_fidelity']).toBe('low');
  });

  it('should include input_fidelity: "high" when model is gpt-image-1.5 and input_fidelity provided', async () => {
    await makeProvider().edit({
      image: VALID_B64,
      prompt: 'edit',
      model: 'gpt-image-1.5',
      input_fidelity: 'high',
    });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['input_fidelity']).toBe('high');
  });
});

describe('OpenAICompatibleProvider — variation()', () => {
  beforeEach(() => { mockCreateVariation.mockClear(); });

  it('should call images.createVariation and return ImageResult[]', async () => {
    const results = await makeProvider().variation({ image: VALID_B64, n: 1, size: '1024x1024' });
    expect(results[0].b64_json).toBe('var-b64');
    expect(results[0].model).toBe('dall-e-2');
  });

  it('should pass n and size to createVariation', async () => {
    await makeProvider().variation({ image: VALID_B64, n: 3, size: '512x512' });
    const call = mockCreateVariation.mock.calls[0][0] as Record<string, unknown>;
    expect(call['n']).toBe(3);
    expect(call['size']).toBe('512x512');
  });

  it('should always set response_format to b64_json', async () => {
    await makeProvider().variation({ image: VALID_B64 });
    const call = mockCreateVariation.mock.calls[0][0] as Record<string, unknown>;
    expect(call['response_format']).toBe('b64_json');
  });

  it('should return multiple variations when n > 1', async () => {
    mockCreateVariation.mockResolvedValueOnce({ data: [{ b64_json: 'v1' }, { b64_json: 'v2' }], created: 1000 });
    const results = await makeProvider().variation({ image: VALID_B64, n: 2 });
    expect(results).toHaveLength(2);
  });

  it('should throw on API error', async () => {
    mockCreateVariation.mockRejectedValueOnce(Object.assign(new Error('only square images'), { status: 400 }));
    await expect(makeProvider().variation({ image: VALID_B64 })).rejects.toThrow('Bad request');
  });
});
