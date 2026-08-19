import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from './app.config';

export interface McpRuntimeConfig {
  transport: AppConfig['mcp']['transport'];
  port: number;
}

/** Resolve the normalized configuration produced by appConfig(). */
export function getMcpRuntimeConfig(configService: ConfigService): McpRuntimeConfig {
  return {
    transport: configService.get<AppConfig['mcp']['transport']>('mcp.transport', 'http'),
    port: configService.get<number>('mcp.port', 3000),
  };
}

/**
 * Check whether the configured listener is another instance of this service.
 * The identity marker prevents silently accepting an unrelated process that
 * happens to expose a similarly named health route.
 */
export async function isCompatibleHttpServerRunning(
  host: string,
  port: number,
  timeoutMs = 1_000,
): Promise<boolean> {
  const probeHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  const urlHost = probeHost.includes(':') ? `[${probeHost}]` : probeHost;
  try {
    const response = await fetch(`http://${urlHost}:${port}/health/live`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return false;
    const body = await response.json() as { status?: unknown; service?: unknown };
    return body.status === 'ok' && (body.service === 'image-mcp' || body.service === 'gpt-image-mcp');
  } catch {
    return false;
  }
}
