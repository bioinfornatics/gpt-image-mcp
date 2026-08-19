/**
 * Azure Foundry / Azure OpenAI deployment discovery.
 *
 * Inspired by Goose's `azure_foundry` provider (`fetch_deployments_and_publishers`,
 * `feat/azure-foundry-provider-v2`): deployment names are arbitrary, customer-chosen
 * strings and MUST NOT be used to infer the underlying model or its capabilities.
 * This catalog queries the deployment management endpoint
 * (`GET {endpoint}/deployments?api-version=...`) and returns the authoritative
 * `modelName` / `modelPublisher` metadata Azure reports for each deployment,
 * exactly as Goose's provider does for `modelPublisher`-based routing.
 *
 * Endpoint shape supported (confirmed): Azure AI Foundry *project* endpoints —
 *   https://<hub>.services.ai.azure.com/api/projects/<project>
 * — which, per Goose's `is_project_endpoint()`, default to `api-version=v1` and
 * do not require a version embedded in the inference path. Non-project (MaaS /
 * classic Azure OpenAI resource) endpoints are also supported: no `api-version`
 * is appended unless one is explicitly configured.
 *
 * Pagination follows the `nextLink` field verbatim (an absolute URL), matching
 * Goose's "successive pages are fetched by passing the absolute nextLink URL"
 * behaviour — `fetch()` treats absolute URLs as-is (RFC 3986), no re-parsing.
 *
 * The catalog caches discovered deployments in memory after the first
 * successful fetch (populated lazily, on first use) and only refetches on
 * an explicit `refresh()` call — same trade-off as Goose's
 * `deployment_cache: Arc<Mutex<HashMap<...>>>`, populated as a side effect of
 * `fetch_deployments()`.
 */

/** A single deployment entry as reported by the Azure deployments listing endpoint. */
export interface AzureDeploymentInfo {
  /** Exact, customer-chosen deployment name (opaque, sent verbatim on the wire). */
  readonly name: string;
  /** Authoritative underlying model name reported by Azure (e.g. "gpt-image-2"). */
  readonly modelName?: string;
  /** Authoritative model publisher reported by Azure (e.g. "OpenAI", "Microsoft"). */
  readonly modelPublisher?: string;
}

export interface AzureAuthHeader {
  readonly name: string;
  readonly value: string;
}

/** Resolves a fresh auth header for each request (token refresh, API key, OBO...). */
export type AzureAuthHeaderProvider = () => Promise<AzureAuthHeader>;

/** Thrown when the deployments endpoint rejects the request (401/403). */
export class AzureCatalogAuthError extends Error {
  readonly code = 'azure-catalog-auth' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AzureCatalogAuthError';
  }
}

/** Thrown when the deployments endpoint returns a non-2xx, non-auth status. */
export class AzureCatalogRequestError extends Error {
  readonly code = 'azure-catalog-request' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AzureCatalogRequestError';
  }
}

/** Thrown when the underlying `fetch()` call itself fails (DNS, TLS, timeout...). */
export class AzureCatalogNetworkError extends Error {
  readonly code = 'azure-catalog-network' as const;
  constructor(message: string) {
    super(message);
    this.name = 'AzureCatalogNetworkError';
  }
}

/**
 * Returns true when `endpoint` is an Azure AI Projects endpoint
 * (`https://<hub>.services.ai.azure.com/api/projects/<project>`), matching
 * Goose's `is_project_endpoint()`. Project endpoints default to
 * `api-version=v1` for the deployments listing when none is configured.
 */
export function isAzureProjectEndpoint(endpoint: string): boolean {
  return endpoint.includes('/api/projects/');
}

export interface AzureDeploymentCatalogOptions {
  /** Base endpoint, e.g. `https://hub.services.ai.azure.com/api/projects/my-project`. */
  endpoint: string;
  /** Optional explicit `api-version` query parameter. Overrides the project-endpoint default. */
  apiVersion?: string;
  /** Provides a fresh auth header for every request (shared with inference auth). */
  authHeader: AzureAuthHeaderProvider;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export class AzureDeploymentCatalog {
  private cache = new Map<string, AzureDeploymentInfo>();
  private populated = false;
  private inFlight?: Promise<void>;

  private readonly endpoint: string;
  private readonly apiVersion?: string;
  private readonly authHeader: AzureAuthHeaderProvider;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AzureDeploymentCatalogOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.apiVersion = options.apiVersion;
    this.authHeader = options.authHeader;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Forces a fresh fetch on the next resolution, discarding the in-memory cache. */
  async refresh(): Promise<void> {
    this.populated = false;
    this.cache = new Map();
    await this.ensurePopulated();
  }

  /** All discovered deployments (cached after first successful fetch). */
  async listDeployments(): Promise<AzureDeploymentInfo[]> {
    await this.ensurePopulated();
    return [...this.cache.values()];
  }

  /** Resolve a deployment by its exact, verbatim name. */
  async resolveByDeployment(name: string): Promise<AzureDeploymentInfo | undefined> {
    await this.ensurePopulated();
    return this.cache.get(name);
  }

  /**
   * Resolve a deployment by its underlying `modelName` (case-insensitive,
   * trimmed). Returns the first matching deployment, if any.
   */
  async resolveByModel(modelName: string): Promise<AzureDeploymentInfo | undefined> {
    await this.ensurePopulated();
    const target = modelName.trim().toLowerCase();
    for (const info of this.cache.values()) {
      if (info.modelName?.trim().toLowerCase() === target) return info;
    }
    return undefined;
  }

  private ensurePopulated(): Promise<void> {
    if (this.populated) return Promise.resolve();
    if (!this.inFlight) {
      this.inFlight = this.fetchAll().finally(() => {
        this.inFlight = undefined;
      });
    }
    return this.inFlight;
  }

  private firstPath(): string {
    const version = this.apiVersion ?? (isAzureProjectEndpoint(this.endpoint) ? 'v1' : undefined);
    return version
      ? `${this.endpoint}/deployments?api-version=${encodeURIComponent(version)}`
      : `${this.endpoint}/deployments`;
  }

  private async fetchAll(): Promise<void> {
    const next = new Map<string, AzureDeploymentInfo>();
    const origin = new URL(this.endpoint).origin;
    const visited = new Set<string>();
    let pageCount = 0;
    // `nextLink`, when present, is an absolute URL — passed straight to
    // fetch() as the next request path (matches Goose's ApiClient::build_url
    // absolute-URL passthrough).
    let path: string | undefined = this.firstPath();

    while (path) {
      const url = new URL(path);
      if (url.protocol !== 'https:' || url.origin !== origin) {
        throw new AzureCatalogRequestError('Azure deployments nextLink must remain on the configured HTTPS origin.');
      }
      if (visited.has(url.href)) {
        throw new AzureCatalogRequestError('Azure deployments pagination loop detected.');
      }
      visited.add(url.href);
      pageCount += 1;
      if (pageCount > 100) {
        throw new AzureCatalogRequestError('Azure deployments pagination exceeded 100 pages.');
      }
      let response: Response;
      try {
        const header = await this.authHeader();
        response = await this.fetchImpl(path, {
          headers: { [header.name]: header.value, Accept: 'application/json' },
        });
      } catch (err) {
        throw new AzureCatalogNetworkError(
          `Azure deployments request failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new AzureCatalogAuthError(`Azure deployments endpoint returned ${response.status}`);
      }
      if (!response.ok) {
        throw new AzureCatalogRequestError(`Azure deployments endpoint returned ${response.status}`);
      }

      const json = (await response.json()) as { value?: Array<Record<string, unknown>>; nextLink?: unknown };
      for (const item of json.value ?? []) {
        const name = typeof item['name'] === 'string' ? (item['name'] as string) : undefined;
        if (!name) continue;
        next.set(name, {
          name,
          modelName: typeof item['modelName'] === 'string' ? (item['modelName'] as string) : undefined,
          modelPublisher: typeof item['modelPublisher'] === 'string' ? (item['modelPublisher'] as string) : undefined,
        });
      }

      path = typeof json.nextLink === 'string' ? json.nextLink : undefined;
    }

    this.cache = next;
    this.populated = true;
  }
}
