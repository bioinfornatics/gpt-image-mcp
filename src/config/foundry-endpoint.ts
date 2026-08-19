import type { CliConfigOverride } from './config-resolver';

export interface FoundryEndpointInference {
  provider: 'azure' | 'openai' | 'openrouter';
  resourceName: string;
}

/**
 * Recognizes only exact official OpenAI, Azure and OpenRouter API roots.
 *
 * The hostname contains the AI Services account/resource name, not an Azure
 * resource-group name. A project name is not encoded in this URL and cannot
 * be inferred reliably; callers must provide the project endpoint explicitly
 * when deployment discovery is required.
 */
export function inferFoundryEndpoint(baseUrl: string | undefined): FoundryEndpointInference | undefined {
  if (!baseUrl) return undefined;
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) {
    return undefined;
  }
  if (url.hostname === 'openrouter.ai' && (url.pathname === '' || url.pathname === '/' || url.pathname === '/api/v1')) {
    return { provider: 'openrouter', resourceName: 'openrouter' };
  }
  if (url.hostname === 'api.openai.com' && (url.pathname === '' || url.pathname === '/' || url.pathname === '/v1')) {
    return { provider: 'openai', resourceName: 'openai' };
  }
  const classic = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.openai\.azure\.com$/i.exec(url.hostname);
  if (classic && (url.pathname === '' || url.pathname === '/')) return { provider: 'azure', resourceName: classic[1] };
  const match = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.services\.ai\.azure\.com$/i.exec(url.hostname);
  if (!match || (url.pathname !== '' && url.pathname !== '/')) return undefined;
  return { provider: 'azure', resourceName: match[1] };
}

/** Apply inferred values only where neither CLI nor canonical/legacy env configured them. */
export function withFoundryDefaults(
  cli: CliConfigOverride,
  env: Readonly<Record<string, string | undefined>>,
): CliConfigOverride {
  const baseUrl = cli.baseUrl ?? env['IMAGE_BASE_URL'] ?? env['AZURE_OPENAI_ENDPOINT'] ??
    env['CUSTOM_OPENAI_BASE_URL'] ?? env['OPENAI_BASE_URL'];
  const inferred = inferFoundryEndpoint(baseUrl);
  if (!inferred) return { ...cli };

  const providerConfigured = cli.provider !== undefined || env['IMAGE_PROVIDER'] !== undefined || env['PROVIDER'] !== undefined;
  const modelConfigured = cli.defaultModel !== undefined || env['IMAGE_DEFAULT_MODEL'] !== undefined || env['DEFAULT_MODEL'] !== undefined;
  return {
    ...cli,
    ...(!providerConfigured ? { provider: inferred.provider } : {}),
    ...(inferred.provider === 'openrouter' && !modelConfigured
      ? { defaultModel: 'google/gemini-3.1-flash-image' }
      : {}),
  };
}
