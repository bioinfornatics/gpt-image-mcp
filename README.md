# gpt-image-mcp

> **MCP server** for AI image generation via **OpenAI** and **Azure OpenAI** gpt-image-* models.  
> Built with **Bun + NestJS** · **Streamable HTTP + stdio** transports · **168 tests, 91 % coverage**

---

## Features

| Capability | Detail |
|-----------|--------|
| 🖼️ **image_generate** | Text → image, all gpt-image-* and dall-e models |
| ✏️ **image_edit** | Inpainting with optional mask |
| 🔀 **image_variation** | dall-e-2 variations |
| 🔍 **provider_list / validate** | Connectivity check without generating an image |
| ⚡ **MCP Elicitation** | Interactive parameter refinement (quality, size) |
| 🧠 **MCP Sampling** | Prompt enhancement via client LLM |
| 💾 **MCP Roots** | Save images directly to your workspace |
| 🔒 **Security** | Bearer-token auth, rate limiting, secret masking, path traversal prevention |
| 📊 **Observability** | Prometheus `/metrics`, `/health/live`, `/health/ready` |

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1 **or** Docker
- An OpenAI API key **or** Azure OpenAI resource

### 1 — Install & configure

```bash
git clone https://github.com/your-org/gpt-image-mcp
cd gpt-image-mcp
bun install
cp .env.example .env
# Edit .env — set PROVIDER and your API key (see Configuration below)
```

### 2 — Run (HTTP mode)

```bash
bun run start:http
# MCP endpoint:  http://localhost:3000/mcp
# Health:        http://localhost:3000/health/live
# Metrics:       http://localhost:3000/metrics
```

### 3 — Run (stdio mode for Claude Desktop / Goose)

```bash
bun run start:stdio
```

### 4 — Docker

```bash
docker build -t gpt-image-mcp .

# OpenAI
docker run -p 3000:3000 \
  -e PROVIDER=openai \
  -e OPENAI_API_KEY=sk-... \
  gpt-image-mcp

# Azure OpenAI
docker run -p 3000:3000 \
  -e PROVIDER=azure \
  -e AZURE_OPENAI_ENDPOINT=https://my-resource.openai.azure.com \
  -e AZURE_OPENAI_API_KEY=... \
  -e AZURE_OPENAI_DEPLOYMENT=my-gpt-image-deployment \
  gpt-image-mcp
```

---

## Configuration

Copy `.env.example` to `.env` and fill in the values:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PROVIDER` | ✅ | — | `openai` or `azure` |
| `OPENAI_API_KEY` | ✅ if `PROVIDER=openai` | — | OpenAI API key (`sk-...`) |
| `OPENAI_BASE_URL` | ❌ | `https://api.openai.com/v1` | Override for proxy |
| `AZURE_OPENAI_ENDPOINT` | ✅ if `PROVIDER=azure` | — | `https://myresource.openai.azure.com` |
| `AZURE_OPENAI_API_KEY` | ✅ if `PROVIDER=azure` | — | Azure API key |
| `AZURE_OPENAI_DEPLOYMENT` | ✅ if `PROVIDER=azure` | — | Deployment name |
| `AZURE_OPENAI_API_VERSION` | ❌ | `2025-04-01-preview` | API version |
| `MCP_TRANSPORT` | ❌ | `http` | `http` or `stdio` |
| `PORT` | ❌ | `3000` | HTTP port |
| `MCP_API_KEY` | ❌ | — | Bearer token to protect `/mcp` |
| `DEFAULT_MODEL` | ❌ | `gpt-image-1` | Default image model |
| `USE_ELICITATION` | ❌ | `true` | Enable MCP Elicitation |
| `USE_SAMPLING` | ❌ | `true` | Enable MCP Sampling |
| `MAX_REQUESTS_PER_MINUTE` | ❌ | `60` | Rate limit per client |
| `LOG_LEVEL` | ❌ | `info` | `debug`/`info`/`warn`/`error` |

---

## MCP Client Setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "gpt-image-mcp": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/gpt-image-mcp/src/main.ts"],
      "env": {
        "PROVIDER": "openai",
        "OPENAI_API_KEY": "sk-...",
        "MCP_TRANSPORT": "stdio",
        "LOG_LEVEL": "error"
      }
    }
  }
}
```

> **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

### Goose

Add to your Goose config (`.config/goose/config.yaml`):

```yaml
extensions:
  - name: gpt-image-mcp
    type: stdio
    cmd: bun
    args:
      - run
      - /absolute/path/to/gpt-image-mcp/src/main.ts
    env:
      PROVIDER: openai
      OPENAI_API_KEY: sk-...
      MCP_TRANSPORT: stdio
```

### HTTP / Remote Client

```
POST http://localhost:3000/mcp
Accept: application/json, text/event-stream
Content-Type: application/json
Authorization: Bearer <MCP_API_KEY>   # only if MCP_API_KEY is set

{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"image_generate","arguments":{"prompt":"a cat"}}}
```

---

## Available Models

### OpenAI (`PROVIDER=openai`)

| Model | Notes |
|-------|-------|
| `gpt-image-1` | Default · best quality |
| `gpt-image-1.5` | Faster generation |
| `gpt-image-1-mini` | Most efficient |
| `dall-e-3` | High quality, n=1 only |
| `dall-e-2` | Fastest, supports variation |

### Azure OpenAI (`PROVIDER=azure`)

| Model | Notes |
|-------|-------|
| `gpt-image-1` | Generally available |
| `gpt-image-1.5` | Check regional availability |
| `gpt-image-2` | ⚠️ Limited access — request access via Azure portal |
| `dall-e-3` | GA in most regions |

> **gpt-image-2** requires explicit access approval from Microsoft. A 403 response means your subscription does not have access yet.

---

## Tools Reference

### `image_generate`

```json
{
  "prompt": "A serene Japanese garden at dawn",
  "model": "gpt-image-1",
  "n": 1,
  "size": "1024x1024",
  "quality": "high",
  "background": "transparent",
  "output_format": "webp",
  "output_compression": 85,
  "save_to_workspace": false,
  "response_format": "markdown"
}
```

### `image_edit`

```json
{
  "image": "<base64-encoded-png>",
  "mask": "<base64-encoded-mask>",
  "prompt": "Add a red hat to the person",
  "model": "gpt-image-1"
}
```

### `image_variation`

```json
{
  "image": "<base64-encoded-square-png>",
  "n": 3,
  "size": "1024x1024"
}
```

> ⚠️ Variation requires `dall-e-2` and a square PNG. Not supported by Azure OpenAI.

### `provider_validate`

```json
{ "provider": "openai" }
```

---

## Development

```bash
bun test                  # 168 tests
bun test --coverage       # with coverage report
bun run lint              # ESLint
bun run type-check        # tsc --noEmit
bun run build             # compile to dist/
```

### Project Structure

```
src/
├── config/          # Joi-validated env config
├── mcp/
│   ├── tools/       # 5 MCP tools + Zod schemas
│   ├── features/    # Elicitation, Sampling, Roots
│   └── transport/   # HTTP (stateless) + stdio
├── providers/       # OpenAI + Azure adapters
├── security/        # Auth guard, rate limiter, sanitiser
└── health/          # /health/* + /metrics
test/
├── unit/            # 140+ unit tests (mocked deps)
└── integration/     # 28 integration tests (nock + supertest)
```

---

## Security

- API keys are **never** logged — masked with `***` in all output
- Input prompts are sanitised (null bytes stripped, length enforced)
- Path traversal prevented when saving to workspace roots
- Rate limiting: configurable per-client token bucket
- Optional bearer-token auth on the `/mcp` endpoint
- Container runs as **non-root** user (`mcpuser`)
- Trivy scan runs on every CI build

See [`docs/SECURITY.md`](docs/SECURITY.md) for full threat model.

---

## Architecture

```
MCP Client (Claude / Goose / Cursor)
      │  JSON-RPC 2.0
      ▼
  POST /mcp  (Streamable HTTP)
  or stdio
      │
  ┌───┴────────────────────────────────┐
  │  NestJS Application                │
  │  ┌──────────┐  ┌────────────────┐  │
  │  │ 5 Tools  │  │ MCP Features   │  │
  │  │ schemas  │  │ Elicitation    │  │
  │  │ Zod val. │  │ Sampling       │  │
  │  └────┬─────┘  │ Roots          │  │
  │       │        └────────────────┘  │
  │  ┌────▼──────────────────────────┐ │
  │  │  IImageProvider               │ │
  │  │  OpenAIProvider | AzureProvider│ │
  │  └────┬──────────────────────────┘ │
  └───────┼────────────────────────────┘
          │  HTTPS
          ▼
  OpenAI API / Azure OpenAI
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for C4 diagrams and ADRs.

---

## Contributing

1. Fork → branch → implement with TDD (Red → Green → Refactor)
2. All PRs must have a failing-test commit before the implementation commit
3. Coverage must not drop below 90 %
4. Run `bun run lint && bun run type-check && bun test` before pushing

See [`docs/TDD_STRATEGY.md`](docs/TDD_STRATEGY.md) for the full TDD workflow.

---

## License

MIT
