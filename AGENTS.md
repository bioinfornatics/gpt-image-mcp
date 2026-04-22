# Agent Instructions — gpt-image-mcp

AI coding agent reference for the **gpt-image-mcp** project.  
Stack: **Bun ≥ 1.1 · NestJS 10 · TypeScript strict · MCP SDK v1.x**

---

## 1 — Issue Tracking (Beads)

This project uses **bd** (beads) for all task tracking.

```bash
bd prime                    # Full workflow context + session protocol
bd ready                    # Find available work (no blockers)
bd show <id>                # View issue details
bd update <id> --claim      # Claim work atomically
bd close <id>               # Mark complete
bd dolt push                # Push beads data to remote
```

**Rules — no exceptions:**
- Use `bd` for ALL task tracking — never TodoWrite, TaskCreate, or markdown TODO lists
- Use `bd remember` for persistent notes — never MEMORY.md files
- Run `bd prime` at the start of every session

---

## 2 — Session Completion Protocol

**Work is NOT complete until `git push` succeeds.**

```bash
# 1. File issues for anything unfinished
bd create --type=task --title="..."

# 2. Quality gates (if any code changed)
bun test            # must be 0 failures
bun run type-check  # must be 0 errors
bun run lint        # must be 0 errors

# 3. Update issue status
bd close <id>       # for completed work

# 4. Push everything — MANDATORY
git add -A && git commit -m "..."
git pull --rebase
bd dolt push
git push
git status          # MUST show "up to date with origin"
```

**Critical rules:**
- NEVER stop before pushing — that leaves work stranded locally
- NEVER say "ready to push when you are" — YOU must push
- If `git push` fails, resolve and retry until it succeeds

---

## 3 — Development Commands

```bash
# Run (pick one)
bun run start:http          # HTTP transport on :3000 (MCP + REST)
bun run start:stdio         # stdio transport (Claude Desktop / Goose)
bun run start:dev           # HTTP, auto-restart on file change

# Test
bun test                    # all tests + coverage report
bun test --watch            # watch mode
bun test <path>             # single file
bun test --coverage         # explicit coverage

# Quality
bun run lint                # ESLint
bun run lint:fix            # ESLint --fix
bun run type-check          # tsc --noEmit (no output files)
bun run format              # Prettier

# Build (produces dist/)
bun run build               # tsc -p tsconfig.build.json + chmod +x dist/main.js

# Keychain (keytar optional backend)
bun run secret:store OPENAI_API_KEY     # store in OS keychain
bun run secret:store MCP_API_KEY

# Docker
docker build -t gpt-image-mcp .
docker run -p 3000:3000 \
  -e PROVIDER=openai \
  -e OPENAI_API_KEY=sk-... \
  gpt-image-mcp
```

**Quality gate — all three must pass before any commit:**
```bash
bun test && bun run type-check && bun run lint
```

---

## 4 — Project Architecture

```
src/
├── main.ts                       # Bootstrap: calls resolveSecrets() then NestFactory
├── app.module.ts                 # Root module: imports all feature modules
├── config/
│   ├── app.config.ts             # Joi schema + AppConfig type + factory
│   └── secret-loader.ts         # *_FILE / keytar / plain env resolution
├── mcp/
│   ├── mcp.module.ts             # Wires McpServerService + all tools + guards
│   ├── mcp.server.ts             # McpServer factory, registerTool() calls on init
│   ├── transport/
│   │   ├── http.controller.ts    # POST /mcp — stateless StreamableHTTP, per-request
│   │   └── stdio.bootstrap.ts   # McpStdioBootstrap: connect() + SIGINT/SIGTERM
│   ├── tools/
│   │   ├── schemas.ts            # All Zod schemas + enums (single source of truth)
│   │   ├── image-generate.tool.ts
│   │   ├── image-edit.tool.ts
│   │   ├── image-variation.tool.ts
│   │   ├── provider-list.tool.ts
│   │   └── provider-validate.tool.ts
│   └── features/
│       ├── elicitation.service.ts  # MCP Elicitation — requests params from client
│       ├── sampling.service.ts     # MCP Sampling — prompt enhancement via client LLM
│       └── roots.service.ts        # MCP Roots — workspace discovery + file save
├── providers/
│   ├── provider.interface.ts     # IImageProvider contract + PROVIDER_TOKEN
│   ├── providers.module.ts       # Factory: selects OpenAI or Azure from config
│   ├── openai/openai.provider.ts # generate / edit / variation / validate
│   └── azure/azure.provider.ts  # generate / edit / variation (throws) / validate
├── security/
│   ├── auth.guard.ts             # Bearer token guard (MCP_API_KEY, constant-time)
│   ├── rate-limit.guard.ts      # Per-session-ID sliding window, Prometheus tracked
│   └── sanitise.ts              # maskSecret / sanitisePrompt / validateFilePath
├── health/
│   ├── health.controller.ts      # GET /health/live  GET /health/ready
│   └── metrics.controller.ts    # GET /metrics — Prometheus text format
└── cli/
    └── store-secret.ts           # CLI: bun run secret:store <VAR>

test/
├── setup.ts                      # Global: sets stub env vars before any test
├── unit/                         # 175+ unit tests (mocked deps)
│   ├── config/                   # app.config.spec.ts · secret-loader.spec.ts
│   ├── health/                   # metrics.controller.spec.ts
│   ├── mcp/
│   │   ├── mcp.server.spec.ts
│   │   ├── features/             # elicitation / sampling / roots specs
│   │   └── tools/                # all 5 tools + image-generate.with-features.spec.ts
│   ├── providers/                # openai · azure · openai.edit-variation · azure.edit
│   └── security/                 # sanitise · auth.guard · rate-limit.guard
└── integration/
    ├── mcp/                      # http-transport · tools (all 5 via supertest)
    ├── providers/                # openai.provider (nock HTTP interception)
    └── security/                 # sanitisation end-to-end
```

---

## 5 — Key Design Decisions

### Secret resolution (startup order)
```
main.ts → resolveSecrets() → (keytar | *_FILE | plain env) → Joi validation → NestJS bootstrap
```
- `MCP_SECRET_BACKEND=file` (default) — reads `OPENAI_API_KEY_FILE` etc.
- `MCP_SECRET_BACKEND=keytar` — OS keychain first, then `_FILE` fallback
- `MCP_SECRET_BACKEND=env` — plain env vars only (dev opt-out)
- **Never** set `SECRET_BACKEND` — that is a reserved `libsecret` variable on Linux

### MCP tool registration
All tools call `(server as any).registerTool(name, meta, handler)` in their `register()` method.  
The `(server as any)` cast works around TS2589 deep-type instantiation from Zod + MCP SDK.

### Tool `execute()` signature
```typescript
async execute(rawParams: unknown, server?: unknown): Promise<ToolResult>
```
`server` is optional — all M4 features (Elicitation, Sampling, Roots) gracefully no-op when `server` is `undefined`. The `register()` callback passes `extra?.server`.

### MCP protocol capabilities
- **Elicitation / Sampling / Roots** are **client** capabilities — the *client* declares them in `initialize`. The server checks `clientCapabilities.X` at runtime before calling them.
- The server advertises `{ tools: {}, logging: {} }` in its own capabilities.

### Transport
- **HTTP** (default): stateless, one `StreamableHTTPServerTransport` per request — horizontally scalable, no session state.
- **stdio**: single persistent connection, for Claude Desktop / Goose / Cursor.

### Response formats
All image tools return `response_format: "markdown"` (default) or `"json"`:
- `markdown` → `[{ type: "text", text: "# ..." }, { type: "image", data: b64, mimeType }]`
- `json` → `[{ type: "text", text: JSON.stringify({ model, count, images: [...] }) }]`

### Provider abstraction
```typescript
interface IImageProvider {
  name: string
  generate(params): Promise<ImageResult[]>
  edit(params): Promise<ImageResult[]>
  variation(params): Promise<ImageResult[]>  // Azure throws — not supported
  validate(): Promise<ValidationResult>
}
```
Injected as `PROVIDER_TOKEN`. Switch provider with `PROVIDER=openai|azure` env var.

### Error handling
- All tool `execute()` methods catch and return `{ isError: true, content: [{ type: "text", text: "Error: ..." }] }`
- API keys are **never** in error messages — `maskSecret()` is called on all error strings
- Provider `normalizeError()` maps HTTP status codes to user-friendly messages (401 → auth, 403 → access denied / gpt-image-2 limited access, 429 → rate limit, 404 → not found)

### gpt-image-2 (Azure only)
Requires explicit access approval from Microsoft. A 403 response triggers a clear "request access via Azure portal" error. The `provider_list` tool annotates it as `(limited access)`.

---

## 6 — TDD Workflow

This project follows **Red → Green → Refactor** strictly.

1. Write a failing test first
2. Write the minimum implementation to make it pass
3. Refactor without breaking tests
4. Coverage must not drop below **90 % lines / 90 % functions**

```bash
bun test --watch    # keep running while writing
bun test --coverage # check thresholds before committing
```

**Test patterns:**
- Unit tests: mock all dependencies with `jest.fn()` / `jest.mock()`
- Integration tests: use `nock` for HTTP interception, `supertest` for NestJS HTTP
- Error paths: always test at least one failure case per method
- Security: API key masking tested explicitly (assert log output does not contain raw key)

**Commit message format:**
```
feat(scope): short description

- bullet of what changed
- test count: X pass / 0 fail
- coverage: N% lines
```

---

## 7 — Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PROVIDER` | ✅ | — | `openai` or `azure` |
| `OPENAI_API_KEY` | ✅ if openai | — | API key (or use `OPENAI_API_KEY_FILE`) |
| `OPENAI_API_KEY_FILE` | — | — | Path to file containing the key |
| `AZURE_OPENAI_ENDPOINT` | ✅ if azure | — | `https://resource.openai.azure.com` |
| `AZURE_OPENAI_API_KEY` | ✅ if azure | — | Azure key (or use `_FILE` variant) |
| `AZURE_OPENAI_DEPLOYMENT` | ✅ if azure | — | Deployment name |
| `AZURE_OPENAI_API_VERSION` | — | `2025-04-01-preview` | API version |
| `MCP_TRANSPORT` | — | `http` | `http` or `stdio` |
| `PORT` | — | `3000` | HTTP listen port |
| `MCP_API_KEY` | — | — | Bearer token for `/mcp` endpoint (or use `_FILE`) |
| `MCP_API_KEY_FILE` | — | — | Path to file containing the MCP bearer token |
| `MCP_SECRET_BACKEND` | — | `file` | `file`, `keytar`, or `env` |
| `DEFAULT_MODEL` | — | `gpt-image-1` | Default image model |
| `USE_ELICITATION` | — | `true` | Enable MCP Elicitation |
| `USE_SAMPLING` | — | `true` | Enable MCP Sampling |
| `MAX_REQUESTS_PER_MINUTE` | — | `60` | Rate limit per client |
| `LOG_LEVEL` | — | `info` | `debug` / `info` / `warn` / `error` |

**Test environment** (set by `test/setup.ts` before any spec runs):
```
PROVIDER=openai · OPENAI_API_KEY=sk-test-fake-key-for-tests
MCP_TRANSPORT=http · PORT=3001 · LOG_LEVEL=error
```

---

## 8 — Non-Interactive Shell Commands

Shell commands like `cp`, `mv`, `rm` may be aliased to interactive mode on some systems — the agent will hang indefinitely waiting for input.

**Always use:**
```bash
cp -f  source dest          # NOT: cp source dest
mv -f  source dest          # NOT: mv source dest
rm -f  file                 # NOT: rm file
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

Other commands that may prompt:
- `scp` → use `-o BatchMode=yes`
- `ssh` → use `-o BatchMode=yes`
- `apt-get` → use `-y`
- `brew` → prefix `HOMEBREW_NO_AUTO_UPDATE=1`

---

## 9 — Docs & References

| File | Contents |
|------|----------|
| `docs/SPECIFICATION.md` | FR-001…010, NFR, acceptance criteria |
| `docs/ARCHITECTURE.md` | C4 diagrams, ADRs (6), deployment topologies |
| `docs/TDD_STRATEGY.md` | Test pyramid, coverage targets, patterns |
| `docs/API.md` | Full MCP tool API reference with examples |
| `docs/SECURITY.md` | Threat model, OWASP, incident response |
| `docs/TEAM_ROLES.md` | SA / BE / QA / SC / CD roles + RACI |
| `docs/MILESTONES.md` | M1–M6 milestones, US-001…020 user stories |
| `examples/claude-desktop-config.json` | 6 ready-to-paste Claude Desktop configs |
| `examples/goose-config.yaml` | 6 Goose config variants |

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
---

## Beads Issue Tracker

Run `bd prime` for the full command reference and session close protocol.

### Rules
- Use `bd` for ALL task tracking — never TodoWrite / TaskCreate / markdown TODO lists
- Use `bd remember` for persistent knowledge — never MEMORY.md files
<!-- END BEADS INTEGRATION -->
