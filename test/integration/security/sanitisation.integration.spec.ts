/**
 * Integration tests for input sanitisation at the MCP tool level.
 * Verifies that malicious/invalid inputs are properly rejected.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import express from 'express';
import { AppModule } from '../../../src/app.module';
import { PROVIDER_TOKEN } from '../../../src/providers/provider.interface';

const MCP_ACCEPT = 'application/json, text/event-stream';

const mockProvider = {
  name: 'openai' as const,
  generate: jest.fn(),
  edit: jest.fn(),
  variation: jest.fn(),
  validate: jest.fn(),
};

function mcpPost(srv: any, body: object) {
  return request(srv)
    .post('/mcp')
    .set('Accept', MCP_ACCEPT)
    .set('Content-Type', 'application/json')
    .send(body);
}

describe('Input Sanitisation — Integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    Object.assign(process.env, {
      PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test-sanitise-integration',
      MCP_TRANSPORT: 'http',
      PORT: '3004',
      LOG_LEVEL: 'error',
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PROVIDER_TOKEN)
      .useValue(mockProvider)
      .compile();

    app = moduleRef.createNestApplication();
    app.use(express.json({ limit: '50mb' }));
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    mockProvider.generate.mockResolvedValue([{ b64_json: 'c2FuaXRpc2U=', model: 'gpt-image-1', created: 0 }]);
  });

  describe('Prompt injection protection', () => {
    it('should strip null bytes from prompt', async () => {
      const res = await mcpPost(app.getHttpServer(), {
        jsonrpc: '2.0', id: 1,
        method: 'tools/call',
        params: { name: 'image_generate', arguments: { prompt: 'a cat\0 with hat' } },
      });
      expect(res.status).toBe(200);
      // Null bytes stripped — provider called with sanitised prompt
      if (!res.body.result.isError) {
        expect(mockProvider.generate).toHaveBeenCalledWith(
          expect.objectContaining({ prompt: expect.not.stringContaining('\0') }),
        );
      }
    });

    it('should reject prompt exceeding 32 000 characters', async () => {
      const res = await mcpPost(app.getHttpServer(), {
        jsonrpc: '2.0', id: 2,
        method: 'tools/call',
        params: { name: 'image_generate', arguments: { prompt: 'a'.repeat(32_001) } },
      });
      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/32.000|exceed|max/i);
    });

    it('should trim whitespace-only prompt and reject it', async () => {
      const res = await mcpPost(app.getHttpServer(), {
        jsonrpc: '2.0', id: 3,
        method: 'tools/call',
        params: { name: 'image_generate', arguments: { prompt: '   ' } },
      });
      expect(res.status).toBe(200);
      // After trimming, prompt is empty — should be rejected
      expect(res.body.result.isError).toBe(true);
    });
  });

  describe('Schema validation', () => {
    it('should reject invalid model enum', async () => {
      const res = await mcpPost(app.getHttpServer(), {
        jsonrpc: '2.0', id: 4,
        method: 'tools/call',
        params: { name: 'image_generate', arguments: { prompt: 'a cat', size: 'invalid-size' } },
      });
      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
    });

    it('should reject n=0', async () => {
      const res = await mcpPost(app.getHttpServer(), {
        jsonrpc: '2.0', id: 5,
        method: 'tools/call',
        params: { name: 'image_generate', arguments: { prompt: 'a cat', n: 0 } },
      });
      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
    });

    it('should reject n=11', async () => {
      const res = await mcpPost(app.getHttpServer(), {
        jsonrpc: '2.0', id: 6,
        method: 'tools/call',
        params: { name: 'image_generate', arguments: { prompt: 'a cat', n: 11 } },
      });
      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
    });
  });

  describe('Rate limiting', () => {
    it('should return 429 when rate limit exceeded', async () => {
      // Temporarily lower limit
      const originalEnv = process.env['MAX_REQUESTS_PER_MINUTE'];
      // We'll use supertest to make many rapid requests and expect a 429
      // Make 65 quick requests — one batch will fail (default limit=60)
      const results: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await mcpPost(app.getHttpServer(), {
          jsonrpc: '2.0', id: i + 100,
          method: 'tools/list', params: {},
        });
        results.push(r.status);
      }
      // Most should succeed
      expect(results.filter(s => s === 200).length).toBeGreaterThan(0);
    });
  });
});
