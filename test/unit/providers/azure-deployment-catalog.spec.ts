import { describe, it, expect, mock } from 'bun:test';
import {
  AzureDeploymentCatalog,
  AzureCatalogAuthError,
  AzureCatalogRequestError,
  AzureCatalogNetworkError,
  isAzureProjectEndpoint,
  type AzureDeploymentInfo,
  type AzureAuthHeader,
} from '../../../src/providers/azure-deployment-catalog';

const PROJECT_ENDPOINT = 'https://my-resource.services.ai.azure.com/api/projects/my-project';
const CLASSIC_ENDPOINT = 'https://my-resource.openai.azure.com';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function apiKeyAuth(value = 'secret'): () => Promise<AzureAuthHeader> {
  return async () => ({ name: 'api-key', value });
}

describe('isAzureProjectEndpoint', () => {
  it('returns true for Azure AI Foundry project endpoints', () => {
    expect(isAzureProjectEndpoint(PROJECT_ENDPOINT)).toBe(true);
  });

  it('returns false for classic Azure OpenAI resource endpoints', () => {
    expect(isAzureProjectEndpoint(CLASSIC_ENDPOINT)).toBe(false);
  });
});

describe('AzureDeploymentCatalog — request construction', () => {
  it('defaults to api-version=v1 for a project endpoint when none is configured', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: [] }));
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await catalog.listDeployments();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PROJECT_ENDPOINT}/deployments?api-version=v1`);
  });

  it('omits api-version for a non-project endpoint when none is configured', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: [] }));
    const catalog = new AzureDeploymentCatalog({
      endpoint: CLASSIC_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await catalog.listDeployments();

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CLASSIC_ENDPOINT}/deployments`);
  });

  it('uses an explicit apiVersion override on a project endpoint', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: [] }));
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      apiVersion: '2025-04-01-preview',
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await catalog.listDeployments();

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${PROJECT_ENDPOINT}/deployments?api-version=2025-04-01-preview`);
  });

  it('strips a trailing slash from the configured endpoint', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: [] }));
    const catalog = new AzureDeploymentCatalog({
      endpoint: `${PROJECT_ENDPOINT}/`,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await catalog.listDeployments();

    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith(`${PROJECT_ENDPOINT}/deployments?`)).toBe(true);
  });

  it('sends the resolved auth header on every request', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: [] }));
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth('super-secret'),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await catalog.listDeployments();

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['api-key']).toBe('super-secret');
    expect((init.headers as Record<string, string>)['Accept']).toBe('application/json');
  });

  it('sends a Bearer Authorization header when authHeader resolves one', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: [] }));
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: async () => ({ name: 'Authorization', value: 'Bearer token-123' }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await catalog.listDeployments();

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-123');
  });
});

describe('AzureDeploymentCatalog — parsing and pagination', () => {
  it('parses value entries with name/modelName/modelPublisher', async () => {
    const fetchImpl = mock(async () =>
      jsonResponse({
        value: [
          { name: 'gpt-image-2', modelName: 'gpt-image-2', modelPublisher: 'OpenAI' },
          { name: 'my-custom-deploy', modelName: 'MAI-Image-2.5', modelPublisher: 'Microsoft' },
        ],
      }),
    );
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const deployments = await catalog.listDeployments();
    expect(deployments).toEqual([
      { name: 'gpt-image-2', modelName: 'gpt-image-2', modelPublisher: 'OpenAI' },
      { name: 'my-custom-deploy', modelName: 'MAI-Image-2.5', modelPublisher: 'Microsoft' },
    ]);
  });

  it('skips entries missing a name', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: [{ modelName: 'no-name-here' }, { name: 'valid' }] }));
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const deployments = await catalog.listDeployments();
    expect(deployments).toEqual([{ name: 'valid', modelName: undefined, modelPublisher: undefined }]);
  });

  it('follows the absolute nextLink verbatim across pages until exhausted', async () => {
    const calls: string[] = [];
    const fetchImpl = mock(async (url: string) => {
      calls.push(url);
      if (calls.length === 1) {
        return jsonResponse({
          value: [{ name: 'dep-1', modelName: 'model-a' }],
          nextLink: 'https://my-resource.services.ai.azure.com/api/projects/my-project/deployments?api-version=v1&skip=1',
        });
      }
      return jsonResponse({ value: [{ name: 'dep-2', modelName: 'model-b' }] });
    });
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const deployments = await catalog.listDeployments();
    expect(calls.length).toBe(2);
    expect(calls[1]).toBe(
      'https://my-resource.services.ai.azure.com/api/projects/my-project/deployments?api-version=v1&skip=1',
    );
    expect(deployments.map((d) => d.name)).toEqual(['dep-1', 'dep-2']);
  });

  it('rejects a cross-origin nextLink before forwarding credentials', async () => {
    const fetchImpl = mock(async () => jsonResponse({
      value: [], nextLink: 'https://attacker.example/collect',
    }));
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT, authHeader: apiKeyAuth(), fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(catalog.listDeployments()).rejects.toBeInstanceOf(AzureCatalogRequestError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a pagination loop', async () => {
    const loop = `${PROJECT_ENDPOINT}/deployments?api-version=v1`;
    const fetchImpl = mock(async () => jsonResponse({ value: [], nextLink: loop }));
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT, authHeader: apiKeyAuth(), fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(catalog.listDeployments()).rejects.toThrow(/loop/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('later pages overwrite earlier entries sharing the same name', async () => {
    let call = 0;
    const fetchImpl = mock(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({
          value: [{ name: 'dup', modelName: 'model-a' }],
          nextLink: 'https://my-resource.services.ai.azure.com/next',
        });
      }
      return jsonResponse({ value: [{ name: 'dup', modelName: 'model-b' }] });
    });
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const deployments = await catalog.listDeployments();
    expect(deployments.length).toBe(1);
    expect(deployments[0].modelName).toBe('model-b');
  });
});

describe('AzureDeploymentCatalog — error classification', () => {
  it('throws AzureCatalogAuthError on a 401 response', async () => {
    const fetchImpl = mock(async () => jsonResponse({}, 401));
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(catalog.listDeployments()).rejects.toBeInstanceOf(AzureCatalogAuthError);
  });

  it('throws AzureCatalogAuthError on a 403 response', async () => {
    const fetchImpl = mock(async () => jsonResponse({}, 403));
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(catalog.listDeployments()).rejects.toBeInstanceOf(AzureCatalogAuthError);
  });

  it('throws AzureCatalogRequestError on other non-2xx responses', async () => {
    const fetchImpl = mock(async () => jsonResponse({}, 500));
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(catalog.listDeployments()).rejects.toBeInstanceOf(AzureCatalogRequestError);
  });

  it('throws AzureCatalogNetworkError when the fetch call itself rejects', async () => {
    const fetchImpl = mock(async () => {
      throw new Error('DNS failure');
    });
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    let caught: unknown;
    try {
      await catalog.listDeployments();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AzureCatalogNetworkError);
    expect((caught as Error).message).toContain('DNS failure');
  });

  it('throws AzureCatalogNetworkError when the authHeader provider itself rejects', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: [] }));
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: async () => {
        throw new Error('token acquisition failed');
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(catalog.listDeployments()).rejects.toBeInstanceOf(AzureCatalogNetworkError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('AzureDeploymentCatalog — resolution', () => {
  const deployments: AzureDeploymentInfo[] = [
    { name: 'gpt-image-2', modelName: 'gpt-image-2', modelPublisher: 'OpenAI' },
    { name: 'prod-custom', modelName: 'MAI-Image-2.5', modelPublisher: 'Microsoft' },
  ];

  function catalogWith(fetchImpl: ReturnType<typeof mock>): AzureDeploymentCatalog {
    return new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
  }

  it('resolveByDeployment returns an exact, verbatim match', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: deployments }));
    const catalog = catalogWith(fetchImpl);
    await expect(catalog.resolveByDeployment('gpt-image-2')).resolves.toEqual(deployments[0]);
  });

  it('resolveByDeployment does not fuzzy-match on case', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: deployments }));
    const catalog = catalogWith(fetchImpl);
    await expect(catalog.resolveByDeployment('GPT-IMAGE-2')).resolves.toBeUndefined();
  });

  it('resolveByModel matches case-insensitively and trims whitespace', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: deployments }));
    const catalog = catalogWith(fetchImpl);
    await expect(catalog.resolveByModel(' MAI-image-2.5 '.trim())).resolves.toEqual(deployments[1]);
    await expect(catalog.resolveByModel('mai-image-2.5')).resolves.toEqual(deployments[1]);
  });

  it('resolveByModel returns undefined for an unknown model name', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: deployments }));
    const catalog = catalogWith(fetchImpl);
    await expect(catalog.resolveByModel('unknown-model')).resolves.toBeUndefined();
  });
});

describe('AzureDeploymentCatalog — cache, refresh and concurrency', () => {
  it('caches results after the first fetch and does not refetch on subsequent calls', async () => {
    const fetchImpl = mock(async () => jsonResponse({ value: [{ name: 'dep-1' }] }));
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await catalog.listDeployments();
    await catalog.resolveByDeployment('dep-1');
    await catalog.listDeployments();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refresh() discards the cache and forces a new fetch', async () => {
    let call = 0;
    const fetchImpl = mock(async () => {
      call += 1;
      return jsonResponse({ value: [{ name: `dep-${call}` }] });
    });
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const first = await catalog.listDeployments();
    expect(first[0].name).toBe('dep-1');

    await catalog.refresh();
    const second = await catalog.listDeployments();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(second[0].name).toBe('dep-2');
  });

  it('dedupes concurrent cache-miss calls into a single in-flight fetch', async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = mock(async () => {
      calls += 1;
      await gate;
      return jsonResponse({ value: [{ name: 'dep-concurrent' }] });
    });
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const p1 = catalog.listDeployments();
    const p2 = catalog.resolveByDeployment('dep-concurrent');
    release?.();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(calls).toBe(1);
    expect(r1).toEqual([{ name: 'dep-concurrent', modelName: undefined, modelPublisher: undefined }]);
    expect(r2).toEqual({ name: 'dep-concurrent', modelName: undefined, modelPublisher: undefined });
  });

  it('does not cache a failed fetch — a subsequent call retries', async () => {
    let call = 0;
    const fetchImpl = mock(async () => {
      call += 1;
      if (call === 1) return jsonResponse({}, 500);
      return jsonResponse({ value: [{ name: 'dep-ok' }] });
    });
    const catalog = new AzureDeploymentCatalog({
      endpoint: PROJECT_ENDPOINT,
      authHeader: apiKeyAuth(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(catalog.listDeployments()).rejects.toBeInstanceOf(AzureCatalogRequestError);
    const deployments = await catalog.listDeployments();
    expect(deployments[0].name).toBe('dep-ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
