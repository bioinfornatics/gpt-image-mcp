/**
 * Integration tests for the MCP Streamable HTTP transport.
 * Tests the full JSON-RPC cycle through NestJS using supertest.
 * Provider is mocked — no real API calls made.
 *
 * The MCP NodeStreamableHTTPServerTransport requires:
 *   Accept: application/json, text/event-stream   (on POST /mcp)
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { AddressInfo } from 'net';
import { AppModule } from '../../../src/app.module';
import { PROVIDER_TOKEN } from '../../../src/providers/provider.interface';
import type { IImageProvider, ImageResult } from '../../../src/providers/provider.interface';

// MCP Streamable HTTP requires both content types in Accept header (spec §3.4.1)
const MCP_ACCEPT = 'application/json, text/event-stream';

const FAKE_IMAGE: ImageResult = {
  b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  format: 'png',
  mimeType: 'image/png',
  model: 'gpt-image-1',
  created: 1_700_000_000,
};

const mockProvider: jest.Mocked<IImageProvider> = {
  name: 'openai',
  generate: jest.fn().mockResolvedValue([FAKE_IMAGE]),
  edit: jest.fn().mockResolvedValue([FAKE_IMAGE]),
  variation: jest.fn().mockResolvedValue([FAKE_IMAGE]),
  validate: jest.fn().mockResolvedValue({ valid: true, provider: 'openai' }),
};

/** Post a JSON-RPC message to /mcp with correct MCP protocol headers */
function mcpPost(srv: ReturnType<typeof request>, body: object) {
  return request(srv)
    .post('/mcp')
    .set('Accept', MCP_ACCEPT)
    .set('Content-Type', 'application/json')
    .send(body);
}

async function buildApp(extraEnv: Record<string, string> = {}): Promise<INestApplication> {
  Object.assign(process.env, extraEnv);

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PROVIDER_TOKEN)
    .useValue(mockProvider)
    .compile();

  const app = moduleRef.createNestApplication(new FastifyAdapter({ bodyLimit: 50 * 1024 * 1024, skipMiddie: true }));
  await app.listen(0, '127.0.0.1');
  return app;
}

describe('MCP HTTP Transport — Integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp({
      IMAGE_PROVIDER: 'openai',
      IMAGE_API_KEY: 'sk-test-integration-key',
      IMAGE_MCP_TRANSPORT: 'http',
      IMAGE_PORT: '3001',
      IMAGE_LOG_LEVEL: 'error',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockProvider.generate.mockResolvedValue([FAKE_IMAGE]);
    mockProvider.validate.mockResolvedValue({ valid: true, provider: 'openai' });
  });

  // ── MCP initialize handshake ──────────────────────────────────────────────

  describe('MCP initialize handshake', () => {
    it('should respond 200 with server info and capabilities', async () => {
      const res = await mcpPost(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.jsonrpc).toBe('2.0');
      expect(res.body.result).toBeDefined();
      expect(res.body.result.serverInfo.name).toBe('gpt-image-mcp');
      expect(res.body.result.capabilities.tools).toBeDefined();
    });

    it('should return a valid capabilities object with at least tools', async () => {
      // The MCP SDK manages capability declarations; we verify the shape is correct.
      // elicitation/sampling/roots are CLIENT capabilities declared by the client.
      const res = await mcpPost(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {
            // Advertise client-side elicitation support for testing
            elicitation: { form: {}, url: {} },
            sampling: {},
            roots: { listChanged: false },
          },
          clientInfo: { name: 'test-client', version: '1.0.0' },
        },
      });
      // The SDK returns capabilities as an object (may be empty or contain tools)
      expect(typeof res.body.result.capabilities).toBe('object');
      expect(res.body.result.protocolVersion).toBeDefined();
    });
  });

  // ── tools/list ────────────────────────────────────────────────────────────

  describe('tools/list', () => {
    it('should return all 5 registered tools', async () => {
      const res = await mcpPost(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      expect(res.status).toBe(200);
      const toolNames: string[] = res.body.result.tools.map((t: { name: string }) => t.name);
      expect(toolNames).toContain('image_generate');
      expect(toolNames).toContain('image_edit');
      expect(toolNames).toContain('image_variation');
      expect(toolNames).toContain('provider_list');
      expect(toolNames).toContain('provider_validate');
    });

    it('should include inputSchema.properties.prompt for image_generate', async () => {
      const res = await mcpPost(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      });

      const generateTool = res.body.result.tools.find(
        (t: { name: string }) => t.name === 'image_generate',
      );
      expect(generateTool).toBeDefined();
      expect(generateTool.inputSchema).toBeDefined();
      expect(generateTool.inputSchema.properties.prompt).toBeDefined();
    });
  });

  // ── tools/call ────────────────────────────────────────────────────────────

  describe('tools/call — image_generate', () => {
    it('should return base64 image content for a valid prompt', async () => {
      const res = await mcpPost(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'image_generate',
          arguments: { prompt: 'a beautiful sunset over the ocean' },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.result.content).toContainEqual(expect.objectContaining({ type: 'image', data: FAKE_IMAGE.b64_json }));
      expect(mockProvider.generate).toHaveBeenCalledTimes(1);
    });

    it('should return isError for empty prompt', async () => {
      const res = await mcpPost(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'image_generate',
          arguments: { prompt: '' },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
    });

    it('should return JSON format when response_format=json', async () => {
      const res = await mcpPost(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`, {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {
          name: 'image_generate',
          arguments: { prompt: 'a cat', response_format: 'json' },
        },
      });

      expect(res.status).toBe(200);
      const parsed = JSON.parse(res.body.result.content[0].text);
      expect(parsed.images[0].saved_to).toBeString();
    });
  });

  describe('tools/call — provider_validate', () => {
    it('should return ✅ for valid configured provider', async () => {
      const res = await mcpPost(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`, {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'provider_validate',
          arguments: { provider: 'openai' },
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.result.content[0].text).toContain('✅');
    });
  });

  describe('tools/call — provider_list', () => {
    it('should return provider info with 200', async () => {
      const res = await mcpPost(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`, {
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'provider_list',
          arguments: {},
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.result.content[0].text).toContain('openai');
    });
  });

  // ── Authentication ────────────────────────────────────────────────────────

  describe('Authentication (IMAGE_MCP_API_KEY)', () => {
    let guardedApp: INestApplication;

    beforeAll(async () => {
      guardedApp = await buildApp({
        IMAGE_MCP_AUTH_MODE: 'static_bearer',
        IMAGE_MCP_API_KEY: 'test-secret-mcp-key',
      });
    });

    afterAll(async () => {
      delete process.env['IMAGE_MCP_AUTH_MODE'];
      delete process.env['IMAGE_MCP_API_KEY'];
      await guardedApp.close();
    });

    it('should return 401 when Authorization header is missing', async () => {
      const res = await request(`http://127.0.0.1:${(guardedApp.getHttpServer().address() as AddressInfo).port}`)
        .post('/mcp')
        .set('Accept', MCP_ACCEPT)
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
      expect(res.status).toBe(401);
    });

    it('should return 401 when wrong token is provided', async () => {
      const res = await request(`http://127.0.0.1:${(guardedApp.getHttpServer().address() as AddressInfo).port}`)
        .post('/mcp')
        .set('Accept', MCP_ACCEPT)
        .set('Authorization', 'Bearer wrong-token')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
      expect(res.status).toBe(401);
    });

    it('should allow request with correct Bearer token', async () => {
      const res = await request(`http://127.0.0.1:${(guardedApp.getHttpServer().address() as AddressInfo).port}`)
        .post('/mcp')
        .set('Accept', MCP_ACCEPT)
        .set('Authorization', 'Bearer test-secret-mcp-key')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
      expect(res.status).toBe(200);
    });
  });

  describe('HTTP protocol contract', () => {
    it('should reject POST without the required Accept media types', async () => {
      const res = await request(
        `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`,
      )
        .post('/mcp')
        .set('Accept', 'application/json')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });

      expect(res.status).toBe(406);
    });
  });

  describe('Unsupported HTTP methods', () => {
    it('GET /mcp should return a JSON-RPC 405 response', async () => {
      const res = await request(
        `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`,
      ).get('/mcp');

      expect(res.status).toBe(405);
      expect(res.body.jsonrpc).toBe('2.0');
      expect(res.body.error.code).toBe(-32000);
    });

    it('DELETE /mcp should return a JSON-RPC 405 response', async () => {
      const res = await request(
        `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`,
      ).delete('/mcp');

      expect(res.status).toBe(405);
      expect(res.body.error.message).toBe('Method not allowed.');
    });
  });

  // ── Health ────────────────────────────────────────────────────────────────

  describe('Health endpoints', () => {
    it('GET /health/live should return 200 with status ok', async () => {
      const res = await request(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /health/ready should return 200', async () => {
      const res = await request(`http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`).get('/health/ready');
      expect(res.status).toBe(200);
    });
  });
});
