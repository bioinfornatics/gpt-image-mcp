# Code Review Report — gpt-image-mcp

**Date:** 2026-04-23  
**Reviewers:** Software Architect · Backend Engineer · QA Automation · Security Champion · Container & DevOps  
**Method:** Parallel independent reviews, each with a distinct lens  
**Baseline:** 211 tests passing · 92.5% line coverage · TypeScript strict · 0 linter errors

---

## Executive Summary

The project has a solid foundation — clean module graph, no circular dependencies, consistent secret masking, thorough unit tests, and working CI. However, five critical bugs were identified that affect production correctness and security. None were caught by the existing test suite because the tests verify paths that do not reflect actual production invocation.

**Fix these before any production deployment.**

---

## 🔴 Critical Issues (production broken or exploitable)

### C1 — M4 features are completely dead code in production
**Files:** `src/mcp/tools/image-generate.tool.ts` L56–58  
**Reviewers:** Architect · Backend · QA

`RequestHandlerExtra` (the `extra` argument in tool handlers) has the shape `{ signal, sessionId, requestInfo, authInfo }` — **no `.server` property**. The code reads:

```typescript
async (params: unknown, extra?: Record<string, unknown>) => {
  const mcpServer = extra?.server as AnyServer | undefined;  // ← ALWAYS undefined
  return self.execute(params, mcpServer);
}
```

Every `if (server)` branch in `execute()` — sampling, elicitation, roots, and `save_to_workspace` — **silently no-ops** for every real MCP client invocation. The `image-generate.with-features.spec.ts` tests all pass because they call `execute()` directly with a mock server object, bypassing the tool handler. They test a path that is never reached in production.

**Fix:** Close over the `McpServer` instance in `register()`:
```typescript
register(server: McpServer) {
  const self = this;
  (server as any).registerTool('image_generate', meta,
    async (params: unknown) => self.execute(params, server)  // server captured, not extra.server
  );
}
```

---

### C2 — `MCP_SECRET_BACKEND` typo in `docker-compose.yml`
**File:** `docker-compose.yml` L30  
**Reviewers:** Security · DevOps · Architect

```yaml
- SECRET_BACKEND=file    # ← WRONG: reserved by libsecret on Linux
```

`SECRET_BACKEND` is a Linux environment variable used by `libsecret` to select which GNOME keyring backend plugin to load. Setting it to `file` instructs the system keyring daemon to look for a plugin called "file", which doesn't exist. On Linux this can crash or corrupt the secret service. The application's variable is `MCP_SECRET_BACKEND`. With this bug, **no `*_FILE` secrets are ever resolved** — the server starts without API keys and all image generation calls fail.

**Fix:**
```yaml
- MCP_SECRET_BACKEND=file    # ← correct
```

---

### C3 — Non-constant-time token comparison (timing attack)
**File:** `src/security/auth.guard.ts`  
**Reviewers:** Security · Architect · QA  
**CWE:** CWE-208

The `MCP_API_KEY` bearer token is compared with JavaScript string equality (`!==`), which short-circuits on the first mismatched byte. An attacker can brute-force the key character-by-character by measuring response latency variance.

**Fix:**
```typescript
import { timingSafeEqual } from 'crypto';

const provided = Buffer.from(token);
const expected = Buffer.from(mcpConfig.apiKey);
if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
  throw new UnauthorizedException('Invalid API key');
}
```

---

### C4 — LLM sampling output not re-sanitised before use
**File:** `src/mcp/tools/image-generate.tool.ts` L108  
**Reviewers:** Security · Backend  
**CWE:** CWE-77 · LLM02 (Insecure Output Handling)

The flow is:
1. User prompt → `sanitisePrompt()` ✅
2. Sanitised prompt → `sampling.enhancePrompt()` — LLM response replaces `prompt`
3. LLM-enhanced prompt → `provider.generate()` — **no sanitisation** ❌

A malicious MCP client can control its LLM's sampling response, injecting null bytes, RTL override characters (`U+202E`), or 32 001-character strings that bypass the initial sanitisation and go directly to the image provider.

**Fix:** Re-sanitise after sampling:
```typescript
prompt = await this.sampling.enhancePrompt(server as never, prompt, params.model);
// Treat all LLM output as untrusted:
prompt = sanitisePrompt(prompt, PROMPT_MAX_LENGTH_GPT);
```

---

### C5 — `response_format: 'b64_json'` missing for DALL-E models
**File:** `src/providers/openai/openai.provider.ts` · `src/providers/azure/azure.provider.ts`  
**Reviewer:** Backend

Both providers call `images.generate()` and `images.edit()` without specifying `response_format: 'b64_json'`. For `dall-e-2` and `dall-e-3`, the API default is URL-based responses. The code then reads `img.b64_json` which will be `null`, producing empty strings as image data. GPT-image models ignore this field (they always return base64), so GPT-image generation works; DALL-E generation and all edits are silently broken.

**Fix (openai.provider.ts):**
```typescript
const isDallE = params.model.startsWith('dall-e');
const response = await this.client.images.generate({
  ...coreParams,
  ...(isDallE
    ? { response_format: 'b64_json' as const }
    : { background: params.background, output_format: params.output_format, /* ... */ }),
});
```
Apply same pattern to `edit()` and in `azure.provider.ts`.

---

## 🟠 High Issues (significant functional gaps)

### H1 — `maskSecret()` not called in outer catch block
**File:** `src/mcp/tools/image-generate.tool.ts` L158  
**CWE:** CWE-209 · CWE-532

```typescript
catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  this.logger.error(`image_generate failed: ${message}`);          // ← unmasked
  return { content: [{ text: `Error: ${message}` }], isError: true }; // ← unmasked
}
```

If a secondary error occurs (e.g. JSON parse failure containing API key material from a response body), the raw message is logged and returned to the MCP client.

**Fix:**
```typescript
const safeMessage = maskSecret(message);
this.logger.error(`image_generate failed: ${safeMessage}`);
content: [{ text: `Error: ${safeMessage}` }]
```

---

### H2 — Feature services use raw JSON-RPC method strings instead of SDK v1.29 named methods
**Files:** `src/mcp/features/elicitation.service.ts` · `sampling.service.ts` · `roots.service.ts`  
**Reviewers:** Architect · Backend

SDK v1.29 (the version actually installed — `package.json` says `^1.10.2` but bun resolved `1.29.0`) provides named methods that include capability pre-checks:

| Current (fragile) | Correct for SDK v1.29 |
|-------------------|----------------------|
| `(server as any).request({ method: 'elicitation/create', ... }, {} as any)` | `(server as any).elicitInput({ message, requestedSchema })` |
| `(server as any).request({ method: 'sampling/createMessage', ... }, {} as any)` | `(server as any).createMessage({ messages, maxTokens, systemPrompt })` |
| `(server as any).request({ method: 'roots/list', ... }, {} as any)` | `(server as any).listRoots()` |

The `{} as any` result schema also bypasses response validation.

---

### H3 — `save_to_workspace` silently ignored in `image_edit` and `image_variation`
**Files:** `src/mcp/tools/image-edit.tool.ts` · `src/mcp/tools/image-variation.tool.ts`  
**Reviewers:** Architect · Backend

Both tools declare and parse `save_to_workspace` in their Zod schemas, but `execute()` never reads or acts on the field. The documented feature silently does nothing. Either implement it (add `RootsService` injection and the same save loop as `image-generate`) or remove the field from the schemas.

---

### H4 — Hard-coded `image/png` MIME type in data URIs
**Files:** All three tool `formatMarkdown()` methods  
**Reviewer:** Backend

```typescript
lines.push(`**Data:** data:image/png;base64,${img.b64_json}`);
```

When `output_format=jpeg` or `webp`, the data URI has the wrong MIME type. Browsers and image renderers use the declared type for codec selection — a JPEG payload with a `image/png` declaration will fail to decode.

**Fix:** Pass `output_format` to `formatMarkdown()` and use the correct MIME type. Long-term: add `format: string` to `ImageResult` and populate it in the provider.

---

### H5 — Rate limiter uses client IP without proxy trust configuration
**Files:** `src/security/rate-limit.guard.ts` · `src/main.ts`  
**Reviewers:** Security · Architect

Behind a load balancer or reverse proxy, `request.ip` is the proxy's IP — all real clients share one bucket. Additionally, the in-memory `Map` never evicts expired entries (unbounded memory growth) and resets on every process restart (no persistence across replicas).

**Fixes:**
1. Add `app.set('trust proxy', 1)` in `main.ts` after app creation
2. Add TTL eviction: sweep the `Map` on each `canActivate()` for entries older than `windowMs`
3. Document that distributed deployments require an external store (Redis)

---

### H6 — Client-supplied workspace root accepted without server-side validation
**File:** `src/mcp/features/roots.service.ts`  
**Reviewer:** Security · CWE-22 (Path Traversal)

`firstRoot.uri` comes from the MCP client's `roots/list` response. A malicious client can declare any path as its workspace root — `file:///var/www/html`, `file:///etc` — causing the server to create `<root>/generated/` and write attacker-controlled blobs there (potential webshell upload if the path is web-accessible).

**Fix:** Validate the root against a server-configured allowlist:
```typescript
const ALLOWED_ROOT_PREFIXES = process.env['WORKSPACE_ALLOWED_ROOTS']?.split(':') ?? [];
if (ALLOWED_ROOT_PREFIXES.length && !ALLOWED_ROOT_PREFIXES.some(p => rootPath.startsWith(p))) {
  this.logger.warn(`Root outside allowlist: ${rootPath}`);
  return null;
}
```

---

### H7 — devDependencies shipped in production Docker image
**File:** `Dockerfile`  
**Reviewer:** DevOps

The builder runs `bun install` (all deps), and the runtime stage copies the entire `node_modules` — including `typescript`, `eslint`, `@nestjs/testing`, `nock`, `supertest`, all `@types/*`. Estimated extra weight: ~60–80 MB. Larger attack surface for CVE scanning.

**Fix:**
```dockerfile
RUN bun run build && bun install --frozen-lockfile --production
# Then COPY --from=builder the production-only node_modules
```

---

## 🟡 Medium Issues

| # | File | Issue |
|---|------|-------|
| M1 | `Dockerfile` | Base image `oven/bun:1.1-slim` not pinned to a digest — mutable tag |
| M2 | `docker-compose.yml` | Healthcheck uses `curl -f` but `bun:slim` ships no `curl` — always `unhealthy` |
| M3 | `ci.yml` | Trivy `exit-code: '0'` — CVEs never block the pipeline |
| M4 | `ci.yml` | `bun pm audit` has `continue-on-error: true` — audit failures silently swallowed |
| M5 | `ci.yml` | `bun-version: latest` is non-deterministic — pin to a specific version |
| M6 | `bunfig.toml` | Coverage thresholds at 60%/55% — far below the 90% M5 target stated in docs |
| M7 | `src/security/sanitise.ts` | No Unicode injection stripping (RTL `U+202E`, zero-width joiners `U+200B`–`U+200D`, bidi controls) |
| M8 | `src/security/sanitise.ts` | Azure API keys (GUID format, no `sk-` prefix) not matched by `maskSecret()` — may log unmasked |
| M9 | `src/security/sanitise.ts` | `validateFilePath()` uses `const path = require('path')` inline — should be top-level import |
| M10 | `src/mcp/features/roots.service.ts` | Reimplements path traversal inline instead of calling `validateFilePath()` from `sanitise.ts` |
| M11 | `src/mcp/features/roots.service.ts` | `uriToPath()` silently fails for `file://localhost/path` and Windows `file:///C:/` URIs |
| M12 | `src/providers/azure/azure.provider.ts` | `normalizeError()` string-matches on masked message text instead of numeric status code |
| M13 | `src/main.ts` | `NestFactory.create` logger level ignores `LOG_LEVEL` config |
| M14 | `src/main.ts` | Variable shadowing: inner `const bootstrap = app.get(McpStdioBootstrap)` shadows outer function |
| M15 | `src/mcp/mcp.server.ts` | `public readonly server` exposes SDK internals; should be `private` with purpose-built methods |
| M16 | `src/providers/provider.interface.ts` | `Symbol()` without `Symbol.for()` — not process-globally unique |
| M17 | `src/health/metrics.controller.ts` | All Prometheus counters/histograms defined but never incremented anywhere in the codebase |
| M18 | `test/integration/mcp/*.spec.ts` | `protocolVersion: '2025-11-05'` is not a real MCP version — use `'2025-03-26'` |
| M19 | `test/integration/security/sanitisation.integration.spec.ts` | Rate-limit test makes 5 requests (limit: 60/min) and never asserts HTTP 429 — vacuously passing |

---

## 🟢 Strengths (keep as-is)

- **Module graph**: Clean `AppModule → McpModule → ProvidersModule` with no circular deps
- **Secret resolution**: `resolveSecrets()` before `NestFactory.create()` — correct startup ordering
- **`IImageProvider` abstraction**: Clean interface, proper DI token, zero tool changes to swap provider
- **Stateless HTTP transport**: One transport per request — horizontally scalable by design
- **Single Zod schema source of truth**: No schema drift risk between `register()` and `execute()`
- **Graceful MCP feature degradation**: All feature services catch and fall back silently
- **`maskSecret()` in provider error paths**: Both providers consistently mask before logging/re-throwing
- **Docker secrets plumbing**: Correct `external` secrets + `*_FILE` pattern in compose
- **Multi-stage Dockerfile**: devDeps excluded from runtime stage (but see H7 — not all of them)
- **Multi-arch CI build**: `linux/amd64,linux/arm64` correct for modern deployments
- **Elicitation schema safety**: Only requests style params, never passwords/API keys

---

## Priority Fix Order

```
1. C2  — docker-compose.yml: SECRET_BACKEND → MCP_SECRET_BACKEND        (1 line, blocks all production secrets)
2. C1  — image-generate.tool.ts: close over server in register()         (2 lines, activates all M4 features)
3. C3  — auth.guard.ts: timingSafeEqual token comparison                 (5 lines)
4. C4  — image-generate.tool.ts: sanitisePrompt() after sampling         (1 line)
5. C5  — openai/azure provider: add response_format: 'b64_json'          (DALL-E images are blank without this)
6. H1  — image-generate.tool.ts: maskSecret() in outer catch             (2 lines)
7. H2  — feature services: SDK v1.29 named methods (elicitInput etc.)    (3 files)
8. H4  — rate-limit.guard: add Map TTL eviction                          (1 function)
9. H7  — Dockerfile: bun install --production prune                      (1 line)
10. M2 — docker-compose.yml: fix curl healthcheck                        (3 lines)
11. M3 — ci.yml: Trivy exit-code: '1'                                    (1 char)
12. M6 — bunfig.toml: raise coverage thresholds to 90/85                 (2 numbers)
```
