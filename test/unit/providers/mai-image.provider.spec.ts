import { describe, it, expect, mock } from 'bun:test';
import {
  MaiImageProvider,
  MAI_MODEL_NAME,
  MAI_MIN_EDGE,
  MAI_MAX_PIXELS,
  parseMaiSize,
} from '../../../src/providers/mai-image.provider';
import { isMaiImageDeployment } from '../../../src/providers/azure-deployment-registry';

const VALID_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function apiKeyAuth(value = 'secret'): () => Promise<{ name: string; value: string }> {
  return async () => ({ name: 'api-key', value });
}

function makeProvider(fetchImpl: typeof fetch, deployment = 'MAI-Image-2.5') {
  return new MaiImageProvider({
    endpoint: 'https://my-resource.services.ai.azure.com',
    deployment,
    authHeader: apiKeyAuth(),
    fetchImpl,
  });
}

describe('isMaiImageDeployment', () => {
  it('matches "MAI-Image-2.5" case-insensitively', () => {
    expect(isMaiImageDeployment('MAI-Image-2.5')).toBe(true);
    expect(isMaiImageDeployment('mai-image-2.5')).toBe(true);
    expect(isMaiImageDeployment(' MAI-Image-2.5 ')).toBe(true);
  });

  it('returns false for other deployments', () => {
    expect(isMaiImageDeployment('gpt-image-2')).toBe(false);
    expect(isMaiImageDeployment(undefined)).toBe(false);
  });
});

describe('parseMaiSize', () => {
  it('defaults to 1024x1024 when size is absent or "auto"', () => {
    expect(parseMaiSize(undefined)).toEqual({ width: 1024, height: 1024 });
    expect(parseMaiSize('auto')).toEqual({ width: 1024, height: 1024 });
  });

  it('accepts a valid WxH within bounds', () => {
    expect(parseMaiSize('768x768')).toEqual({ width: 768, height: 768 });
  });

  it('rejects width or height below the minimum edge', () => {
    expect(() => parseMaiSize('700x1000')).toThrow(new RegExp(`>= ${MAI_MIN_EDGE}`));
    expect(() => parseMaiSize('1000x700')).toThrow(new RegExp(`>= ${MAI_MIN_EDGE}`));
  });

  it('rejects total pixels above the maximum', () => {
    // 1024 * 1025 > 1,048,576
    expect(() => parseMaiSize('1024x1025')).toThrow(new RegExp(`<= ${MAI_MAX_PIXELS}`));
  });

  it('rejects malformed size strings', () => {
    expect(() => parseMaiSize('not-a-size')).toThrow(/Invalid size/);
  });
});

describe('MaiImageProvider.generate', () => {
  it('POSTs to /mai/v1/images/generations with model/prompt/width/height', async () => {
    const fetchImpl = mock(async () => jsonResponse({ data: [{ b64_json: VALID_PNG_B64 }], created: 1234 }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);

    const result = await provider.generate({ prompt: 'a cat', model: 'MAI-Image-2.5', size: '1024x1024' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://my-resource.services.ai.azure.com/mai/v1/images/generations');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ model: 'MAI-Image-2.5', prompt: 'a cat', width: 1024, height: 1024 });

    expect(result).toHaveLength(1);
    expect(result[0].format).toBe('png');
    expect(result[0].model).toBe('MAI-Image-2.5');
  });

  it('rejects an explicit unsupported quality value', async () => {
    const fetchImpl = mock(async () => jsonResponse({ data: [] }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.generate({ prompt: 'x', model: 'MAI-Image-2.5', quality: 'low' })).rejects.toThrow(
      /does not support a "quality" parameter/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows quality "auto" (treated as absent)', async () => {
    const fetchImpl = mock(async () => jsonResponse({ data: [{ b64_json: VALID_PNG_B64 }] }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.generate({ prompt: 'x', model: 'MAI-Image-2.5', quality: 'auto' })).resolves.toHaveLength(1);
  });

  it('rejects out-of-bounds size before any network call', async () => {
    const fetchImpl = mock(async () => jsonResponse({ data: [] }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.generate({ prompt: 'x', model: 'MAI-Image-2.5', size: '512x512' })).rejects.toThrow(
      new RegExp(`>= ${MAI_MIN_EDGE}`),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('turns DallEBlockList content-safety responses into actionable retry guidance', async () => {
    const fetchImpl = mock(async () => jsonResponse({
      error: { code: 'content_safety_violation', message: "Response content blocked by label 'DallEBlockList'." },
    }, 400));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.generate({ prompt: 'pharmaceutical laboratory', model: 'MAI-Image-2.5' }))
      .rejects.toThrow(/Content safety blocked the generated response.*rephrase.*retry/i);
  });

  it('maps HTTP error statuses to a descriptive, masked error', async () => {
    const fetchImpl = mock(async () => jsonResponse({ error: 'nope' }, 401));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.generate({ prompt: 'x', model: 'MAI-Image-2.5' })).rejects.toThrow(
      new RegExp(`${MAI_MODEL_NAME} Authentication failed \\(HTTP 401\\)`),
    );
  });

  it('throws when the response contains no image data', async () => {
    const fetchImpl = mock(async () => jsonResponse({ data: [] }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.generate({ prompt: 'x', model: 'MAI-Image-2.5' })).rejects.toThrow(/returned no image data/);
  });

  it('rejects a non-PNG output payload', async () => {
    const jpegB64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
    const fetchImpl = mock(async () => jsonResponse({ data: [{ b64_json: jpegB64 }] }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.generate({ prompt: 'x', model: 'MAI-Image-2.5' })).rejects.toThrow(/must be PNG/);
  });
});

describe('MaiImageProvider.edit', () => {
  it('POSTs to /mai/v1/images/edits with the source image', async () => {
    const fetchImpl = mock(async () => jsonResponse({ data: [{ b64_json: VALID_PNG_B64 }] }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    const result = await provider.edit({ image: VALID_PNG_B64, prompt: 'add a hat', model: 'MAI-Image-2.5' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://my-resource.services.ai.azure.com/mai/v1/images/edits');
    const body = JSON.parse(init.body as string);
    expect(body.image).toBe(VALID_PNG_B64);
    expect(result).toHaveLength(1);
  });

  it('requires an image input', async () => {
    const fetchImpl = mock(async () => jsonResponse({ data: [] }));
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.edit({ prompt: 'x', model: 'MAI-Image-2.5' })).rejects.toThrow(/requires an "image"/);
  });
});

describe('MaiImageProvider.variation', () => {
  it('is not supported', async () => {
    const provider = makeProvider(mock(async () => jsonResponse({})) as unknown as typeof fetch);
    await expect(provider.variation({ image: VALID_PNG_B64 })).rejects.toThrow(/not supported by MAI-Image-2.5/);
  });
});

describe('MaiImageProvider.validate', () => {
  it('reports valid when a deployment name is configured', async () => {
    const provider = makeProvider(mock(async () => jsonResponse({})) as unknown as typeof fetch);
    await expect(provider.validate()).resolves.toEqual({ valid: true, provider: 'azure', deployment: 'MAI-Image-2.5' });
  });

  it('reports invalid when deployment is empty', async () => {
    const provider = new MaiImageProvider({
      endpoint: 'https://x.services.ai.azure.com',
      deployment: '  ',
      authHeader: apiKeyAuth(),
      fetchImpl: mock(async () => jsonResponse({})) as unknown as typeof fetch,
    });
    const result = await provider.validate();
    expect(result.valid).toBe(false);
  });
});

describe('MaiImageProvider — network failure', () => {
  it('wraps and masks a fetch() rejection', async () => {
    const fetchImpl = mock(async () => {
      throw new Error('DNS failure sk-abcdefghijklmnopqrstuvwxyz123456');
    });
    const provider = makeProvider(fetchImpl as unknown as typeof fetch);
    await expect(provider.generate({ prompt: 'x', model: 'MAI-Image-2.5' })).rejects.toThrow(/request failed/);
  });
});
