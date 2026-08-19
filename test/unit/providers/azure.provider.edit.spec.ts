import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OpenAICompatibleProvider } from '../../../src/providers/openai-compatible.provider';
import { AzureStrategy } from '../../../src/providers/strategies/azure.strategy';
import type OpenAI from 'openai';

const mockEdit = mock(() => Promise.resolve({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }], created: 2000 }));

// "gpt-image-2" is the only deployment name currently confirmed in the
// internal Azure deployment adapter registry (see azure-deployment-registry.ts).
// Since AzureStrategy resolves capabilities from the registry family (not
// the caller's `params.model`), all parameter-building tests below use
// model: 'gpt-image-2' so the caller's model matches the resolved family;
// unresolved-deployment and mismatch behavior is exercised in their own
// describe/test blocks.
function makeProvider(deployment = 'gpt-image-2') {
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
    const results = await makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-2' });
    expect(results[0].b64_json).toBe('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
    expect(mockEdit).toHaveBeenCalledTimes(1);
  });

  it('should pass mask when provided', async () => {
    await makeProvider().edit({ image: VALID_B64, mask: VALID_B64, prompt: 'edit', model: 'gpt-image-2' });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['mask']).toBeDefined();
  });

  it('should omit mask when not provided', async () => {
    await makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-2' });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['mask']).toBeUndefined();
  });

  it('should always use deployment name as model param on the wire', async () => {
    await makeProvider('gpt-image-2').edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-2' });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call['model']).toBe('gpt-image-2');
  });

  it('should forward Azure edit parameters and omit response_format', async () => {
    await makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-2', quality: 'high', output_format: 'jpeg', output_compression: 80 });
    const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
    expect(call).toMatchObject({ quality: 'high', output_format: 'jpeg', output_compression: 80 });
    expect(call['response_format']).toBeUndefined();
  });

  it('rejects input_fidelity for gpt-image-2 before network I/O', async () => {
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-2', input_fidelity: 'high' })).rejects.toThrow(/not supported by gpt-image-2/);
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it('rejects invalid compression combinations before network I/O', async () => {
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-2', output_compression: 80, output_format: 'png' })).rejects.toThrow(/only supported for jpeg or webp/);
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it('rejects a requested model that conflicts with the deployment resolved family, before network I/O', async () => {
    // AzureStrategy must use the resolved registry family ("gpt-image-2"
    // for this deployment) as the capability source, not the caller's
    // model string — a conflicting caller value throws an actionable
    // mismatch error before any SDK call.
    await expect(makeProvider('gpt-image-2').edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1.5' })).rejects.toThrow(/resolved capability family is "gpt-image-2"/);
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it('rejects an unknown/unsupported model string before network I/O', async () => {
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'totally-bogus-model' })).rejects.toThrow(/Unsupported Azure image model/);
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it('rejects a dall-e model string before network I/O', async () => {
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'dall-e-2' })).rejects.toThrow(/Unsupported Azure image model/);
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it('rejects edit on an arbitrary/unresolved deployment before network I/O', async () => {
    await expect(makeProvider('prod-deployment-42').edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' })).rejects.toThrow(/model-family-unresolved/);
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it('rejects edit on the opaque "MAI-Image-2.5" deployment — capabilities are never inferred from the name', async () => {
    await expect(makeProvider('MAI-Image-2.5').edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-1' })).rejects.toThrow(/model-family-unresolved/);
    expect(mockEdit).not.toHaveBeenCalled();
  });

  it('should throw rate-limit error on 429', async () => {
    mockEdit.mockRejectedValueOnce(new Error('429 Too Many Requests'));
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-2' })).rejects.toThrow('Rate limit exceeded (Azure)');
  });

  it('should throw auth error on 401', async () => {
    mockEdit.mockRejectedValueOnce(new Error('401 Unauthorized'));
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-2' })).rejects.toThrow('Authentication failed');
  });

  it('should throw deployment-not-found error on 404', async () => {
    mockEdit.mockRejectedValueOnce(new Error('404 Not Found'));
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-2' })).rejects.toThrow('gpt-image-2');
  });

  it('should strip data URI prefix from base64', async () => {
    await makeProvider().edit({ image: `data:image/png;base64,${VALID_B64}`, prompt: 'edit', model: 'gpt-image-2' });
    expect(mockEdit).toHaveBeenCalledTimes(1);
  });

  it('should throw a helpful 403/access error with registration link for gpt-image-1.x', async () => {
    mockEdit.mockRejectedValueOnce(new Error('403 Forbidden: Access denied to model gpt-image-1'));
    await expect(makeProvider().edit({ image: VALID_B64, prompt: 'edit', model: 'gpt-image-2' })).rejects.toThrow('aka.ms/oai/gptimage1access');
  });

  // ─── multi-image compositing regression (gpt-image-mcp-o70) ──────────────
  //
  // OpenAICompatibleProvider.edit() is the *single* shared implementation used
  // by both the OpenAI and Azure strategies (see class doc comment in
  // openai-compatible.provider.ts: "Azure is just `new OpenAI({ baseURL: ... })`").
  // There is no Azure-specific branching for images[] — the array→File[]
  // mapping happens before the ProviderStrategy is ever consulted. These tests
  // confirm that behavior explicitly for the Azure strategy so multi-image
  // edit is proven provider-independent, not just OpenAI-specific.
  describe('multi-image compositing (images[]) — provider-independent path', () => {
    it('should map images[] to a File[] and forward it to images.edit on the Azure client', async () => {
      await makeProvider().edit({
        images: [VALID_B64, VALID_B64],
        prompt: 'virtual try-on composite',
        model: 'gpt-image-2',
      });
      expect(mockEdit).toHaveBeenCalledTimes(1);
      const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
      expect(Array.isArray(call['image'])).toBe(true);
      expect((call['image'] as unknown[]).length).toBe(2);
    });

    it('should map a single-element images[] the same as a plain image on Azure', async () => {
      await makeProvider().edit({
        images: [VALID_B64],
        prompt: 'single composite',
        model: 'gpt-image-2',
      });
      const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
      expect(Array.isArray(call['image'])).toBe(true);
      expect((call['image'] as unknown[]).length).toBe(1);
    });

    it('should support up to 16 images in a single Azure edit call', async () => {
      const images = Array.from({ length: 16 }, () => VALID_B64);
      await makeProvider().edit({ images, prompt: 'compose 16 images', model: 'gpt-image-2' });
      const call = mockEdit.mock.calls[0][0] as Record<string, unknown>;
      expect((call['image'] as unknown[]).length).toBe(16);
    });

    it('should throw when neither image nor images[] is provided on Azure', async () => {
      await expect(
        makeProvider().edit({ prompt: 'edit', model: 'gpt-image-2' }),
      ).rejects.toThrow(/Either image or images must be provided/);
      expect(mockEdit).not.toHaveBeenCalled();
    });
  });
});
