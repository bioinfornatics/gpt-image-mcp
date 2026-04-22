# TDD Strategy — gpt-image-mcp

**Owner:** QA Automation Engineer  
**Date:** 2026-04-22

---

## 1. Philosophy

`gpt-image-mcp` follows **strict Test-Driven Development**:

> **Red → Green → Refactor**  
> Every line of production code is preceded by a failing test.

This is not optional. PRs that introduce production code without a prior failing-test commit will be rejected in review.

### Why TDD for an MCP Server?

1. **Protocol compliance** — MCP spec correctness is verifiable; tests _are_ the spec
2. **Provider isolation** — we never call real OpenAI/Azure in unit tests (cost + flakiness)
3. **Security guarantees** — "API key never in logs" is a _test_, not a policy document
4. **Refactoring confidence** — clean module boundaries invite confident iterative change

---

## 2. Test Pyramid

```
         ┌──────────────────┐
         │    E2E Tests     │  ← Real MCP client + real server, mocked provider HTTP
         │   (few, slow)    │    ~5 % of test count
         └──────────────────┘
       ┌──────────────────────┐
       │  Integration Tests   │  ← NestJS module + mocked HTTP (nock / msw)
       │  (moderate, medium)  │    ~25 % of test count
       └──────────────────────┘
   ┌──────────────────────────────┐
   │         Unit Tests           │  ← Pure functions, mocked deps via Jest/Bun mocks
   │   (many, fast, isolated)     │    ~70 % of test count
   └──────────────────────────────┘
```

---

## 3. Tooling Stack

| Tool | Role |
|------|------|
| **`bun test`** | Test runner (Jest-compatible API, native speed) |
| **`@nestjs/testing`** | `Test.createTestingModule()` for DI-aware unit/integration tests |
| **`nock`** / **`msw`** | HTTP mocking for provider adapter tests |
| **`supertest`** | HTTP integration testing for NestJS HTTP endpoints |
| **`zod`** | Schema validation in tests (identical to production schemas) |
| **`@modelcontextprotocol/inspector`** | MCP protocol conformance checks in E2E |
| **`bun --coverage` / `c8`** | Code coverage (branches + lines) |
| **Stryker** | Mutation testing — validates that tests actually detect bugs |

---

## 4. Coverage Targets

| Layer | Line | Branch | Mutation Score |
|-------|------|--------|----------------|
| `src/config/` | ≥ 95 % | ≥ 95 % | ≥ 80 % |
| `src/mcp/tools/` | ≥ 90 % | ≥ 90 % | ≥ 75 % |
| `src/mcp/features/` | ≥ 90 % | ≥ 85 % | ≥ 75 % |
| `src/providers/` | ≥ 90 % | ≥ 85 % | ≥ 75 % |
| `src/security/` | ≥ 95 % | ≥ 90 % | ≥ 80 % |
| **Overall** | **≥ 90 %** | **≥ 88 %** | **≥ 75 %** |

Mutation testing runs on every PR. Scores below threshold block merge.

---

## 5. Unit Testing Patterns

### 5.1 Tool Tests — Red First

```typescript
// test/unit/mcp/tools/image-generate.tool.spec.ts
// Written BEFORE image-generate.tool.ts exists

import { Test } from '@nestjs/testing';
import { ImageGenerateTool } from '../../../src/mcp/tools/image-generate.tool';
import { PROVIDER_TOKEN } from '../../../src/providers/provider.factory';
import type { IImageProvider } from '../../../src/providers/provider.interface';

describe('ImageGenerateTool', () => {
  let tool: ImageGenerateTool;
  let mockProvider: jest.Mocked<IImageProvider>;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ImageGenerateTool,
        {
          provide: PROVIDER_TOKEN,
          useValue: { generate: jest.fn() },
        },
      ],
    }).compile();

    tool = module.get(ImageGenerateTool);
    mockProvider = module.get(PROVIDER_TOKEN);
  });

  describe('input validation', () => {
    it('should reject prompt longer than 32 000 characters', async () => {
      const result = await tool.execute({ prompt: 'a'.repeat(32_001) });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/prompt/i);
    });

    it('should reject n > 10', async () => {
      const result = await tool.execute({ prompt: 'a cat', n: 11 });
      expect(result.isError).toBe(true);
    });

    it('should surface clear error when dall-e-3 is called with n > 1', async () => {
      mockProvider.generate.mockRejectedValue(new Error('dall-e-3 only supports n=1'));
      const result = await tool.execute({ prompt: 'a cat', model: 'dall-e-3', n: 2 });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/dall-e-3/i);
    });
  });

  describe('successful generation', () => {
    it('should return markdown containing base64 image by default', async () => {
      mockProvider.generate.mockResolvedValue([
        { b64_json: 'abc123==', model: 'gpt-image-1', created: 1_234_567_890 },
      ]);
      const result = await tool.execute({ prompt: 'a cat' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('abc123==');
    });

    it('should map all parameters correctly to provider.generate()', async () => {
      mockProvider.generate.mockResolvedValue([
        { b64_json: 'x', model: 'gpt-image-1', created: 0 },
      ]);
      await tool.execute({ prompt: 'a cat', model: 'gpt-image-1', quality: 'high', size: '1024x1024' });
      expect(mockProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'a cat', model: 'gpt-image-1', quality: 'high', size: '1024x1024' }),
      );
    });
  });
});
```

### 5.2 Security Tests — Red First

```typescript
// test/unit/security/secret-masking.spec.ts
// Written BEFORE the log masking interceptor exists

describe('Secret Masking', () => {
  it('should NEVER include the API key in any log output', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const apiKey = 'sk-test-supersecretkey123456789';

    const provider = new OpenAIProvider({ apiKey, baseURL: 'http://mock-server' });
    // Trigger a failing call
    await provider.generate({ prompt: 'test', model: 'gpt-image-1' }).catch(() => {});

    const allOutput = [...logSpy.mock.calls.flat(), ...errorSpy.mock.calls.flat()].join(' ');
    expect(allOutput).not.toContain(apiKey);
    expect(allOutput).not.toContain('supersecretkey');

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
```

### 5.3 Config Validation Tests — Red First

```typescript
// test/unit/config/config.schema.spec.ts

describe('ConfigSchema validation', () => {
  it('should throw when PROVIDER is missing', () => {
    expect(() => validateConfig({})).toThrow('PROVIDER is required');
  });

  it('should throw when OPENAI_API_KEY is missing for provider=openai', () => {
    expect(() => validateConfig({ PROVIDER: 'openai' })).toThrow('OPENAI_API_KEY is required');
  });

  it('should throw when AZURE_OPENAI_ENDPOINT is missing for provider=azure', () => {
    expect(() =>
      validateConfig({ PROVIDER: 'azure', AZURE_OPENAI_API_KEY: 'x', AZURE_OPENAI_DEPLOYMENT: 'd' }),
    ).toThrow('AZURE_OPENAI_ENDPOINT is required');
  });

  it('should pass with valid OpenAI config', () => {
    const config = validateConfig({ PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' });
    expect(config.provider).toBe('openai');
  });
});
```

---

## 6. Integration Testing Patterns

### 6.1 Provider Adapter (Mocked HTTP)

```typescript
// test/integration/providers/openai.provider.integration.spec.ts
import nock from 'nock';

describe('OpenAIProvider — Integration', () => {
  beforeEach(() => nock.cleanAll());
  afterAll(() => nock.restore());

  it('should call /images/generations and return ImageResult[]', async () => {
    nock('https://api.openai.com')
      .post('/v1/images/generations')
      .reply(200, { created: 1_234_567_890, data: [{ b64_json: 'base64img==' }] });

    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    const results = await provider.generate({ prompt: 'a cat', model: 'gpt-image-1' });

    expect(results).toHaveLength(1);
    expect(results[0].b64_json).toBe('base64img==');
  });

  it('should throw RateLimitError on HTTP 429', async () => {
    nock('https://api.openai.com')
      .post('/v1/images/generations')
      .reply(429, { error: { message: 'Rate limit exceeded' } });

    const provider = new OpenAIProvider({ apiKey: 'sk-test' });
    await expect(provider.generate({ prompt: 'a cat', model: 'gpt-image-1' }))
      .rejects.toThrow(/rate limit/i);
  });
});
```

### 6.2 Full MCP Tool Call (NestJS + Supertest)

```typescript
// test/integration/mcp/image-generate.integration.spec.ts
import request from 'supertest';

describe('image_generate — MCP integration', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PROVIDER_TOKEN)
      .useValue({ generate: jest.fn().mockResolvedValue([{ b64_json: 'abc==', model: 'gpt-image-1', created: 0 }]) })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('should complete initialize → tools/list → tools/call flow', async () => {
    // Step 1: initialize
    const init = await request(app.getHttpServer()).post('/mcp').send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    expect(init.body.result.capabilities.tools).toBeDefined();

    // Step 2: tools/list
    const list = await request(app.getHttpServer()).post('/mcp').send({
      jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
    });
    expect(list.body.result.tools.map((t: any) => t.name)).toContain('image_generate');

    // Step 3: tools/call
    const call = await request(app.getHttpServer()).post('/mcp').send({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'image_generate', arguments: { prompt: 'a cat' } },
    });
    expect(call.body.result.content[0].text).toContain('abc==');
  });
});
```

---

## 7. E2E Testing

E2E tests run against a real started server process (real NestJS, real HTTP) with mocked provider HTTP responses.

```bash
# Manual: inspect via MCP Inspector
PROVIDER=openai OPENAI_API_KEY=sk-fake bun run start:http &
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

Automated E2E suite (`test/e2e/`) covers:
- Server starts and `/health/live` returns 200
- `initialize` handshake completes with correct capabilities
- `tools/list` returns all 5 tools with correct schemas
- `image_generate` with mocked provider HTTP returns valid base64 result
- Rate limiting: 61st request in 60s window returns rate-limit error
- Wrong/missing `MCP_API_KEY` returns 401 (HTTP transport)
- `save_to_workspace: true` writes file to temp directory, path returned in result

---

## 8. TDD Workflow Per Story

For each User Story in MILESTONES.md:

```
1.  READ the acceptance criteria
2.  CREATE test file (test/unit/ or test/integration/)
3.  WRITE all tests — they MUST fail (Red)
     $ bun test → all new tests fail ✓
4.  COMMIT: "test(scope): red — <story title>"
5.  WRITE minimal production code to make tests pass (Green)
     $ bun test → all pass ✓
6.  COMMIT: "feat(scope): green — <story title>"
7.  REFACTOR — clean up, extract helpers, improve names
     $ bun test → all still pass ✓
8.  COMMIT: "refactor(scope): <what changed>"
9.  OPEN PR — must contain Red commit before Green commit
```

PRs without the Red commit will be sent back for correction.

---

## 9. CI Quality Gates

The pipeline blocks merge when:

| Gate | Threshold / Rule |
|------|-----------------|
| `bun run lint` | 0 errors, 0 warnings |
| `bun run type-check` (`tsc --noEmit`) | 0 errors |
| `bun test` | 0 failures, 0 skipped |
| Line coverage | < 90 % → **FAIL** |
| Branch coverage | < 88 % → **FAIL** |
| Mutation score | < 75 % → **FAIL** (tracked via Stryker) |
| `bun pm audit` | HIGH or CRITICAL → **FAIL** |
| Trivy container scan | HIGH or CRITICAL CVEs → **FAIL** (M6+) |

---

## 10. Test Naming Convention

```
describe('<ClassName or ModuleName>')
  describe('<methodName | scenario group>')
    it('should <expected behaviour> when <condition>')
```

**Examples:**
- `it('should return markdown image block when response_format is default')`
- `it('should throw AuthenticationError when API key is invalid')`
- `it('should never include API key in log output')`
- `it('should reject prompt longer than 32 000 characters')`
- `it('should skip elicitation when client does not declare elicitation capability')`

---

## 11. Test Factories & Shared Utilities

Shared builders live in `test/factories/`:

```typescript
// test/factories/image-result.factory.ts
export const makeImageResult = (overrides: Partial<ImageResult> = {}): ImageResult => ({
  b64_json: 'ZmFrZWltYWdl',
  model: 'gpt-image-1',
  created: 1_700_000_000,
  ...overrides,
});

// test/factories/mcp-request.factory.ts
export const makeMcpToolCall = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0' as const,
  id: Math.floor(Math.random() * 1000),
  method: 'tools/call',
  params: { name, arguments: args },
});
```

---

*TDD Strategy v1.0.0 — 2026-04-22*
