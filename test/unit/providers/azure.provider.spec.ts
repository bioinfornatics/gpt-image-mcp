import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { OpenAICompatibleProvider } from '../../../src/providers/openai-compatible.provider';
import { AzureStrategy } from '../../../src/providers/strategies/azure.strategy';
import type OpenAI from 'openai';

const mockGenerate = mock(() => Promise.resolve({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', revised_prompt: undefined }], created: 2000 }));
const mockModelsList = mock(() => Promise.resolve({ data: [{ id: 'my-deployment' }] }));

// "gpt-image-2" is the only deployment name currently confirmed in the
// internal Azure deployment adapter registry (see azure-deployment-registry.ts)
// — it is used here whenever a test exercises generate()/edit() parameter
// building, which requires the deployment's model family to be resolved.
// Since AzureStrategy now uses the *resolved registry family* — not the
// caller-supplied `params.model` — as the capability source, the caller's
// `model` must also be "gpt-image-2" to avoid an actionable mismatch error.
// Other deployment names (arbitrary, or the opaque "MAI-Image-2.5") are
// exercised separately below to prove they fail fast with
// model-family-unresolved before any network I/O.
function makeProvider(deployment = 'gpt-image-2') {
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

  describe('resolveModel() — exact deployment preservation', () => {
    it('preserves the exact deployment string verbatim, even for an unresolved/opaque name like "MAI-Image-2.5"', () => {
      // resolveModel() must never normalise, lowercase, or otherwise alter
      // the deployment name — it is sent verbatim on the wire regardless of
      // whether azure-deployment-registry.ts can resolve its model family.
      const strategy = new AzureStrategy('MAI-Image-2.5');
      expect(strategy.resolveModel({ model: 'gpt-image-1' })).toBe('MAI-Image-2.5');
    });

    it('preserves the exact deployment string verbatim for the known "gpt-image-2" deployment', () => {
      const strategy = new AzureStrategy('gpt-image-2');
      expect(strategy.resolveModel({ model: 'anything' })).toBe('gpt-image-2');
    });
  });

  describe('generate()', () => {
    it('should return ImageResult[] on success', async () => {
      const results = await makeProvider().generate({ prompt: 'a cat', model: 'gpt-image-2', n: 1 });
      expect(results[0].b64_json).toBe('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
    });

    it('should always use the deployment name as model on the wire', async () => {
      // The wire model sent to Azure is always the deployment name, never
      // the caller's model string, even when they happen to match here.
      await makeProvider('gpt-image-2').generate({ prompt: 'test', model: 'gpt-image-2' });
      const call = mockGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(call['model']).toBe('gpt-image-2');
    });

    it('should pass model, prompt, n, size, quality — no GPT-image-specific extras', async () => {
      await makeProvider().generate({ prompt: 'test', model: 'gpt-image-2', n: 2, size: '1024x1024', quality: 'high' });
      const call = mockGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(call['prompt']).toBe('test');
      expect(call['n']).toBe(2);
      expect(call['size']).toBe('1024x1024');
      expect(call['quality']).toBe('high');
      // Azure strategy does NOT pass GPT-image-specific params when unset
      expect(call['background']).toBeUndefined();
      expect(call['output_format']).toBeUndefined();
      expect(call['moderation']).toBeUndefined();
    });

    it('should forward Azure GPT Image parameters without response_format', async () => {
      await makeProvider().generate({
        prompt: 'test', model: 'gpt-image-2', background: 'transparent', output_format: 'webp',
        output_compression: 80,
      });
      const call = mockGenerate.mock.calls[0][0] as Record<string, unknown>;
      expect(call).toMatchObject({ model: 'gpt-image-2', background: 'transparent', output_format: 'webp', output_compression: 80 });
      expect(call['response_format']).toBeUndefined();
    });

    // Note: gpt-image-1(.5|-mini) parameter-forwarding paths (isGptImage1Series)
    // remain in AzureStrategy for when a deployment resolving to those
    // families is confirmed and added to the registry, but are currently
    // unreachable via the public API: the only registered deployment
    // ("gpt-image-2") requires the caller's model to match exactly
    // "gpt-image-2", per the resolved-family-is-the-capability-source rule.

    it('rejects unsupported Azure parameter combinations before network I/O', async () => {
      await expect(makeProvider().generate({ prompt: 'test', model: 'gpt-image-2', background: 'transparent', output_format: 'jpeg' })).rejects.toThrow(/requires png or webp/);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('rejects a requested model that conflicts with the deployment resolved family, before network I/O', async () => {
      // The deployment "gpt-image-2" resolves (via the internal adapter
      // registry) to the "gpt-image-2" capability family. A caller asking
      // for a different model string — even a plausible one such as
      // "gpt-image-1.5" — must not have that string trusted as the
      // capability source. AzureStrategy must reject this with an
      // actionable mismatch error before any SDK call.
      await expect(makeProvider('gpt-image-2').generate({ prompt: 'test', model: 'gpt-image-1.5' })).rejects.toThrow(/resolved capability family is "gpt-image-2"/);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('rejects another conflicting model string ("gpt-image-1-mini") before network I/O', async () => {
      await expect(makeProvider('gpt-image-2').generate({ prompt: 'test', model: 'gpt-image-1-mini' })).rejects.toThrow(/resolved capability family is "gpt-image-2"/);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('rejects an unknown/unsupported model string before network I/O', async () => {
      await expect(makeProvider().generate({ prompt: 'test', model: 'totally-bogus-model' })).rejects.toThrow(/Unsupported Azure image model/);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('rejects a dall-e model string before network I/O', async () => {
      await expect(makeProvider().generate({ prompt: 'test', model: 'dall-e-3' })).rejects.toThrow(/Unsupported Azure image model/);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('rejects moderation on gpt-image-2 before network I/O', async () => {
      await expect(makeProvider().generate({ prompt: 'test', model: 'gpt-image-2', moderation: 'auto' })).rejects.toThrow(/moderation parameter is only supported for gpt-image-1/);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('rejects generate on an arbitrary/unresolved deployment before network I/O', async () => {
      await expect(makeProvider('prod-deployment-42').generate({ prompt: 'test', model: 'gpt-image-1' })).rejects.toThrow(/model-family-unresolved/);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('rejects generate on the opaque "MAI-Image-2.5" deployment — capabilities are never inferred from the name', async () => {
      await expect(makeProvider('MAI-Image-2.5').generate({ prompt: 'test', model: 'gpt-image-1' })).rejects.toThrow(/model-family-unresolved/);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('should throw rate-limit error on 429 response', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('429 Too Many Requests'));
      await expect(makeProvider().generate({ prompt: 'test', model: 'gpt-image-2' })).rejects.toThrow('Rate limit exceeded (Azure)');
    });

    it('should throw auth error on 401 response', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('401 Unauthorized'));
      await expect(makeProvider().generate({ prompt: 'test', model: 'gpt-image-2' })).rejects.toThrow('Authentication failed');
    });

    it('should throw deployment not found error on 404', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('404 Not Found'));
      await expect(makeProvider().generate({ prompt: 'test', model: 'gpt-image-2' })).rejects.toThrow('gpt-image-2');
    });

    it('should throw a helpful 403/access error with registration link for gpt-image-1.x', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('403 Forbidden: Access denied to model gpt-image-1'));
      await expect(makeProvider().generate({ prompt: 'test', model: 'gpt-image-2' })).rejects.toThrow('aka.ms/oai/gptimage1access');
    });
  });

  describe('variation()', () => {
    it('should always throw — Azure does not support variation', async () => {
      await expect(makeProvider().variation({ image: 'img' })).rejects.toThrow('azure');
    });
  });

  describe('validate()', () => {
    // validate() only confirms deployment existence/reachability via the
    // deployment listing — it never resolves or claims a model family, so
    // arbitrary deployment names (not just "gpt-image-2") are used here.
    it('should return valid=true when models list succeeds and the deployment resolves to a known model family', async () => {
      mockModelsList.mockResolvedValueOnce({ data: [{ id: 'gpt-image-2' }] });
      const result = await makeProvider('gpt-image-2').validate();
      expect(result.valid).toBe(true);
      expect(result.provider).toBe('azure');
    });

    it('should return valid=false on failure', async () => {
      mockModelsList.mockRejectedValueOnce(new Error('network error'));
      const result = await makeProvider('my-deployment').validate();
      expect(result.valid).toBe(false);
    });

    it('should report unresolved/inconclusive — not valid — for a reachable but unresolved deployment such as "MAI-Image-2.5"', async () => {
      // A generic models.list() entry only proves the deployment ID is an
      // opaque, reachable string — it does NOT prove the deployment's model
      // family/capabilities. provider_validate must not claim "valid" here.
      mockModelsList.mockResolvedValueOnce({ data: [{ id: 'MAI-Image-2.5' }] });
      const result = await makeProvider('MAI-Image-2.5').validate();
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/unresolved|inconclusive/i);
      expect(result.error).toMatch(/model-family-unresolved/);
    });

    it('should reject an empty deployment listing instead of claiming valid', async () => {
      mockModelsList.mockResolvedValueOnce({ data: [] });
      const result = await makeProvider('typo-deployment').validate();
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/could not be verified/i);
    });

    it('should reject a deployment absent from a non-empty listing', async () => {
      mockModelsList.mockResolvedValueOnce({ data: [{ id: 'other-deployment' }] });
      const result = await makeProvider('typo-deployment').validate();
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/deployment not found/i);
    });

    it('never treats a generic model ID match as deployment-capability proof for an unresolved deployment', async () => {
      // Even if the models.list() listing happens to contain an entry whose
      // id equals a generic, well-known model ID string (not the deployment
      // name itself, and not an entry backing the registry resolution),
      // provider_validate must still report the unresolved deployment as
      // not valid rather than treating that generic ID as capability proof.
      mockModelsList.mockResolvedValueOnce({ data: [{ id: 'MAI-Image-2.5' }, { id: 'gpt-image-1' }] });
      const result = await makeProvider('MAI-Image-2.5').validate();
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/model-family-unresolved/);
    });
  });
});
