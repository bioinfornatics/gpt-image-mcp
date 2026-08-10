import { ConfigService } from '@nestjs/config';
import { createServer } from 'node:net';
import { getMcpRuntimeConfig, isCompatibleHttpServerRunning } from '../../../src/config/mcp-runtime.config';

describe('MCP runtime config', () => {
  it('reads normalized nested MCP keys', () => {
    const config = new ConfigService({
      mcp: { transport: 'stdio', port: 4321 },
      IMAGE_MCP_TRANSPORT: 'http',
      IMAGE_PORT: 3000,
    });
    expect(getMcpRuntimeConfig(config)).toEqual({ transport: 'stdio', port: 4321 });
  });

  it('uses HTTP defaults when MCP config is absent', () => {
    expect(getMcpRuntimeConfig(new ConfigService({}))).toEqual({ transport: 'http', port: 3000 });
  });

  it('recognizes a compatible server from its liveness endpoint', async () => {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => Response.json({ status: 'ok', service: 'gpt-image-mcp' }),
    });
    try {
      await expect(isCompatibleHttpServerRunning('127.0.0.1', server.port)).resolves.toBe(true);
    } finally {
      server.stop(true);
    }
  });

  it('rejects an unrelated process using the same port', async () => {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => Response.json({ status: 'ok', service: 'something-else' }),
    });
    try {
      await expect(isCompatibleHttpServerRunning('127.0.0.1', server.port)).resolves.toBe(false);
    } finally {
      server.stop(true);
    }
  });

  it('returns false when no process is listening', async () => {
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const address = socket.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const port = address.port;
    await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
    await expect(isCompatibleHttpServerRunning('127.0.0.1', port)).resolves.toBe(false);
  });
});
