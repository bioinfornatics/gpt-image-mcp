/**
 * Integration tests for all 5 MCP tools via HTTP transport.
 * Provider is mocked — no real API calls made.
 *
 * US-009: image_generate integration
 * US-010: image_edit integration
 * US-011: image_variation integration
 * US-012: provider_list / provider_validate integration
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import express from 'express';
import { AppModule } from '../../../src/app.module';
import { PROVIDER_TOKEN } from '../../../src/providers/provider.interface';
import type {
  IImageProvider,
  ImageResult,
  ValidationResult,
} from '../../../src/providers/provider.interface';

// MCP Streamable HTTP requires both content types in Accept header (spec §3.4.1)
const MCP_ACCEPT = 'application/json, text/event-stream';

const FAKE_IMAGE: ImageResult = {
  b64_json: 'dG9vbHNJbnRlZ3JhdGlvbg==',
  model: 'gpt-image-1',
  created: 1_700_000_000,
};

// Minimal valid 1×1 PNG in base64
const VALID_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAABjE+ibYAAAAASUVORK5CYII=';

const mockProvider: jest.Mocked<IImageProvider> = {
  name: 'openai',
  generate: jest.fn().mockResolvedValue([FAKE_IMAGE]),
  edit: jest.fn().mockResolvedValue([FAKE_IMAGE]),
  variation: jest.fn().mockResolvedValue([FAKE_IMAGE]),
  validate: jest.fn().mockResolvedValue({ valid: true, provider: 'openai' } satisfies ValidationResult),
};

/** Post a JSON-RPC tool call to /mcp with correct MCP protocol headers */
function mcpPost(srv: ReturnType<typeof request>, body: object) {
  return request(srv)
    .post('/mcp')
    .set('Accept', MCP_ACCEPT)
    .set('Content-Type', 'application/json')
    .send(body);
}

/** Build a tools/call JSON-RPC request body */
function toolsCall(id: number, name: string, args: Record<string, unknown> = {}) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  };
}

async function buildApp(): Promise<INestApplication> {
  Object.assign(process.env, {
    PROVIDER: 'openai',
    OPENAI_API_KEY: 'sk-test-tools-integration',
    MCP_TRANSPORT: 'http',
    PORT: '3003',
    LOG_LEVEL: 'error',
  });

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PROVIDER_TOKEN)
    .useValue(mockProvider)
    .compile();

  const app = moduleRef.createNestApplication();
  app.use(express.json({ limit: '50mb' }));
  await app.init();
  return app;
}

describe('MCP Tools — Integration (all 5 tools)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockProvider.generate.mockResolvedValue([FAKE_IMAGE]);
    mockProvider.edit.mockResolvedValue([FAKE_IMAGE]);
    mockProvider.variation.mockResolvedValue([FAKE_IMAGE]);
    mockProvider.validate.mockResolvedValue({ valid: true, provider: 'openai' });
  });

  // ── image_generate ──────────────────────────────────────────────────────

  describe('image_generate', () => {
    it('valid prompt returns 200 + base64 in response text', async () => {
      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(10, 'image_generate', { prompt: 'a white cat' }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.isError).toBeFalsy();
      const text: string = res.body.result.content[0].text;
      expect(text).toContain(FAKE_IMAGE.b64_json);
    });

    it('n=2 returns 2 images', async () => {
      const second: ImageResult = { ...FAKE_IMAGE, b64_json: 'c2Vjb25kSW1hZ2U=' };
      mockProvider.generate.mockResolvedValueOnce([FAKE_IMAGE, second]);

      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(11, 'image_generate', { prompt: 'two cats', n: 2 }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBeFalsy();
      const text: string = res.body.result.content[0].text;
      expect(text).toContain(FAKE_IMAGE.b64_json);
      expect(text).toContain(second.b64_json);
    });

    it('response_format=json returns parseable JSON with images array', async () => {
      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(12, 'image_generate', {
          prompt: 'a blue sphere',
          response_format: 'json',
        }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBeFalsy();
      const text: string = res.body.result.content[0].text;
      const parsed = JSON.parse(text);
      expect(parsed).toHaveProperty('images');
      expect(Array.isArray(parsed.images)).toBe(true);
      expect(parsed.images[0].b64_json).toBe(FAKE_IMAGE.b64_json);
    });

    it('empty prompt returns isError: true', async () => {
      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(13, 'image_generate', { prompt: '' }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/validation error/i);
    });

    it('prompt too long (32001 chars) returns isError: true', async () => {
      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(14, 'image_generate', { prompt: 'x'.repeat(32_001) }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
    });

    it('provider error returns isError: true with error message', async () => {
      mockProvider.generate.mockRejectedValueOnce(new Error('API quota exceeded'));

      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(15, 'image_generate', { prompt: 'a cat' }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/API quota exceeded/);
    });
  });

  // ── image_edit ──────────────────────────────────────────────────────────

  describe('image_edit', () => {
    it('valid image + prompt returns 200 + base64', async () => {
      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(20, 'image_edit', {
          image: VALID_B64,
          prompt: 'add a hat',
        }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBeFalsy();
      const text: string = res.body.result.content[0].text;
      expect(text).toContain(FAKE_IMAGE.b64_json);
    });

    it('valid image + mask + prompt calls provider with mask', async () => {
      const maskB64 = VALID_B64; // reuse same small image as mask

      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(21, 'image_edit', {
          image: VALID_B64,
          mask: maskB64,
          prompt: 'fill with red',
        }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBeFalsy();
      expect(mockProvider.edit).toHaveBeenCalledWith(
        expect.objectContaining({ mask: maskB64 }),
      );
    });

    it('empty image returns isError: true', async () => {
      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(22, 'image_edit', {
          image: '',
          prompt: 'add a hat',
        }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
    });
  });

  // ── image_variation ─────────────────────────────────────────────────────

  describe('image_variation', () => {
    it('valid image returns 200 + base64', async () => {
      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(30, 'image_variation', { image: VALID_B64 }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBeFalsy();
      const text: string = res.body.result.content[0].text;
      expect(text).toContain(FAKE_IMAGE.b64_json);
    });

    it('azure provider returns isError: true (not supported)', async () => {
      // Temporarily override provider name to azure
      Object.defineProperty(mockProvider, 'name', { value: 'azure', configurable: true });

      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(31, 'image_variation', { image: VALID_B64 }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);

      // Restore
      Object.defineProperty(mockProvider, 'name', { value: 'openai', configurable: true });
    });
  });

  // ── provider_list ───────────────────────────────────────────────────────

  describe('provider_list', () => {
    it('returns 200 with provider name in text', async () => {
      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(40, 'provider_list', {}),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBeFalsy();
      const text: string = res.body.result.content[0].text;
      expect(text).toMatch(/openai/i);
    });
  });

  // ── provider_validate ───────────────────────────────────────────────────

  describe('provider_validate', () => {
    it('valid provider returns ✅ success message', async () => {
      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(50, 'provider_validate', { provider: 'openai' }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBeFalsy();
      const text: string = res.body.result.content[0].text;
      expect(text).toContain('✅');
    });

    it('wrong provider name returns isError: true', async () => {
      // Active provider is openai, but requesting azure
      const res = await mcpPost(
        app.getHttpServer(),
        toolsCall(51, 'provider_validate', { provider: 'azure' }),
      );

      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/not configured|openai/i);
    });
  });
});
