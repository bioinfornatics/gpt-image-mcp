# gpt-image-mcp

> **A production-grade MCP (Model Context Protocol) service for AI image generation**, built on **Bun + NestJS**, supporting OpenAI and Azure OpenAI `gpt-image-*` models.

[![MCP Spec](https://img.shields.io/badge/MCP-draft%202025--11-blue)](https://modelcontextprotocol.io/specification/draft)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)
[![NestJS](https://img.shields.io/badge/framework-NestJS-red)](https://nestjs.com)
[![TDD](https://img.shields.io/badge/methodology-TDD-green)]()
[![License: CeCILL-2.1](https://img.shields.io/badge/License-CeCILL--2.1-blue.svg)](./LICENSE)

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architecture at a Glance](#architecture-at-a-glance)
4. [Quick Start](#quick-start)
5. [Configuration](#configuration)
6. [MCP Tools](#mcp-tools)
7. [MCP Protocol Features](#mcp-protocol-features)
8. [Supported Providers](#supported-providers)
9. [Documentation](#documentation)
10. [Team](#team)
11. [Contributing](#contributing)

---

## Overview

`gpt-image-mcp` exposes an **MCP server** that lets any MCP-compatible LLM client (Claude Desktop, Goose, Cursor, …) generate and edit images through a standardised protocol layer. It supports:

- **OpenAI** (`/v1/images/generations` — `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1-mini`, `gpt-image-1`; `dall-e-2` for variations only; ~~`dall-e-3`~~ retired 2026-03-04)
- **Azure OpenAI** (Azure AI Foundry endpoint + deployment-based routing)
- **Streaming** partial image previews (GPT image models)
- **MCP Elicitation** — interactive parameter refinement via structured forms
- **MCP Sampling** — prompt enhancement via the client LLM before image API calls
- **MCP Roots** — filesystem workspace awareness for saving generated images

The service follows **TDD** discipline; every module ships with unit + integration tests written before the implementation.

---

## Features

| Feature | Status |
|---------|--------|
| `image_generate` tool (text → image) | 🎯 M3 |
| `image_edit` tool (image + mask → image) | 🎯 M3 |
| `image_variation` tool (dall-e-2) | 🎯 M3 |
| `provider_list` / `provider_validate` tools | 🎯 M2 |
| Streamable HTTP transport | 🎯 M2 |
| stdio transport | 🎯 M2 |
| Multi-provider (OpenAI + Azure) | 🎯 M3 |
| MCP Elicitation (form + URL mode) | 🎯 M4 |
| MCP Sampling (prompt enhancement) | 🎯 M4 |
| MCP Roots (workspace file save) | 🎯 M4 |
| Docker / OCI image | 🎯 M6 |
| Prometheus metrics | 🎯 M5 |
| Rate limiting | 🎯 M5 |
| Secret rotation support | 🎯 M5 |

---

## Architecture at a Glance

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Client                           │
│   (Claude Desktop / Goose / Cursor / …)                 │
└───────────────────────┬─────────────────────────────────┘
                        │ JSON-RPC 2.0 (MCP)
          ┌─────────────▼──────────────────┐
          │     Streamable HTTP  /  stdio   │  ← Transport Layer
          └─────────────┬──────────────────┘
                        │
          ┌─────────────▼──────────────────┐
          │         NestJS App              │
          │  ┌──────────────────────────┐  │
          │  │   McpModule (NestJS)     │  │
          │  │  ┌────────────────────┐  │  │
          │  │  │  ToolsRegistry     │  │  │
          │  │  │  - image_generate  │  │  │
          │  │  │  - image_edit      │  │  │
          │  │  │  - image_variation │  │  │
          │  │  │  - provider_*      │  │  │
          │  │  └────────────────────┘  │  │
          │  │  ┌────────────────────┐  │  │
          │  │  │  MCP Features      │  │  │
          │  │  │  - Elicitation     │  │  │
          │  │  │  - Sampling        │  │  │
          │  │  │  - Roots           │  │  │
          │  │  └────────────────────┘  │  │
          │  └──────────────────────────┘  │
          │  ┌──────────────────────────┐  │
          │  │  ProvidersModule         │  │
          │  │  - OpenAIProvider        │  │
          │  │  - AzureOpenAIProvider   │  │
          │  └──────────────────────────┘  │
          │  ┌──────────────────────────┐  │
          │  │  SecurityModule          │  │
          │  │  - API key validation    │  │
          │  │  - Rate limiting         │  │
          │  │  - Input sanitisation    │  │
          │  └──────────────────────────┘  │
          └────────────────────────────────┘
                        │
          ┌─────────────▼──────────────────┐
          │   OpenAI / Azure OpenAI APIs    │
          └────────────────────────────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full detail.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.1
- OpenAI API key **or** Azure OpenAI endpoint + key

### Install & run (stdio)

```bash
git clone https://github.com/your-org/gpt-image-mcp.git
cd gpt-image-mcp
bun install

# Copy and fill in your provider credentials
cp .env.example .env

bun run start:stdio
```

### Install & run (Streamable HTTP)

```bash
bun run start:http
# Listening on http://localhost:3000/mcp
```

### Run with Docker

```bash
docker run -p 3000:3000 \
  -e IMAGE_PROVIDER=openai \
  -e IMAGE_API_KEY=sk-... \
  ghcr.io/your-org/gpt-image-mcp:latest
```

### Connect to Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gpt-image-mcp": {
      "command": "bun",
      "args": ["run", "/path/to/gpt-image-mcp/src/main.ts", "--transport=stdio"],
      "env": {
        "IMAGE_PROVIDER": "openai",
        "IMAGE_API_KEY": "sk-..."
      }
    }
  }
}
```

---

## Configuration

All configuration is via **environment variables** (never hardcoded).

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `IMAGE_PROVIDER` | ✅ | — | `openai`, `azure`, `together`, or `custom` |
| `IMAGE_API_KEY` | ✅ | — | API key for the configured provider |
| `IMAGE_BASE_URL` | if azure/custom | — | Provider endpoint (e.g. `https://my-res.openai.azure.com` for azure, or your custom OpenAI-compatible URL) |
| `IMAGE_DEPLOYMENT` | if azure | — | Azure deployment name |
| `IMAGE_API_VERSION` | ❌ | `2025-04-01-preview` | Azure API version |
| `IMAGE_MODELS` | if custom | `custom` | Comma-separated model list for custom provider |
| `IMAGE_DEFAULT_MODEL` | ❌ | `gpt-image-1` | Default model for generation requests |
| `IMAGE_MCP_TRANSPORT` | ❌ | `http` | `http` or `stdio` |
| `IMAGE_PORT` | ❌ | `3000` | HTTP server port |
| `IMAGE_MCP_API_KEY` | ❌ | — | Protect the MCP endpoint |
| `IMAGE_LOG_LEVEL` | ❌ | `info` | `debug|info|warn|error` |
| `IMAGE_MAX_REQUESTS_PER_MINUTE` | ❌ | `60` | Rate limit per client |

---

## MCP Tools

| Tool | Description |
|------|-------------|
| `image_generate` | Generate an image from a text prompt |
| `image_edit` | Edit an existing image using a mask and prompt |
| `image_variation` | Create a variation of an existing image (dall-e-2) |
| `provider_list` | List configured providers and their status |
| `provider_validate` | Validate a provider configuration |

Full schemas: see [API.md](./API.md).

---

## MCP Protocol Features

### Elicitation
When a `image_generate` call is made without sufficient parameters (e.g. missing quality, size), the server can request structured input from the user via `elicitation/create` (form mode). Sensitive credentials are never collected via form mode — URL mode is used for any auth flows.

### Sampling
Before calling the image API, the server can request the client LLM to enhance or disambiguate the user's prompt via `sampling/createMessage`. This improves generation quality without requiring the server to hold its own LLM credentials.

### Roots
The server requests `roots/list` to discover the client's workspace directories. Generated images can be saved to the appropriate root directory, respecting the user's project context.

---

## Supported Providers

| Provider | Models | Notes |
|----------|--------|-------|
| OpenAI | `gpt-image-2`, `gpt-image-1.5`, `gpt-image-1-mini`, `gpt-image-1`, `dall-e-2` (variations only) | Direct API |
| Azure OpenAI | `gpt-image-2` (available, no access application needed), `gpt-image-1.5`, `gpt-image-1-mini`, `gpt-image-1` (Limited Access) | Via AI Foundry deployment (`IMAGE_DEPLOYMENT`) — see [Azure deployments and troubleshooting](./authentication/TROUBLESHOOTING.md#azure-deployments-gpt-image-2-and-mai-image-25) |

---

## Documentation

| Document | Description |
|----------|-------------|
| [SPECIFICATION.md](./SPECIFICATION.md) | Full project specification |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Technical architecture |
| [API.md](./API.md) | MCP tools API reference |
| [TEAM_ROLES.md](./TEAM_ROLES.md) | Team roles & responsibilities |
| [TDD_STRATEGY.md](./TDD_STRATEGY.md) | TDD approach & test strategy |
| [SECURITY.md](./SECURITY.md) | Security model & threat analysis |
| [MILESTONES.md](./MILESTONES.md) | Project milestones & user stories |

---

## Team

See [TEAM_ROLES.md](./TEAM_ROLES.md) for full role descriptions.

| Role | Responsibility |
|------|----------------|
| Software Architect | System design, ADRs, protocol conformance |
| Backend Engineer | NestJS modules, providers, MCP tools |
| QA Automation Engineer | TDD, test suites, CI quality gates |
| Security Champion | Threat model, secret hygiene, pen-test |
| Container/DevOps Engineer | Docker, CI/CD, Helm, observability |

---

## Contributing

1. All new features start with a failing test (TDD Red → Green → Refactor)
2. PRs require passing CI (lint + unit + integration)
3. Security-sensitive PRs require Security Champion review
4. See [SPECIFICATION.md](./SPECIFICATION.md) for acceptance criteria per feature

---

## CLI configuration workflows

Configuration is resolved with the following **precedence** (highest wins):

```
CLI flags  >  canonical IMAGE_* env vars  >  legacy aliases  >  built-in defaults
```

### Flags

Every supported flag maps to exactly one canonical `IMAGE_*` configuration key (see
`src/config/config-resolver.ts` field registry and `src/cli/cli-options.ts`):

| Flag | Canonical env key | Purpose |
|------|--------------------|---------|
| `-h`, `--help` | — | Print usage and exit (before any Nest/secret init) |
| `-V`, `--version` | — | Print package version and exit |
| `--check-config` | — | Validate resolved configuration and exit non-zero on error, without starting the server |
| `--show-config-sources` | — | Print each resolved config key alongside the source that provided it (`cli`, `env:IMAGE_*`, `env:<legacy-alias>`, or `default`) |
| `--provider <name>` | `IMAGE_PROVIDER` | `openai` \| `azure` \| `together` \| `custom` |
| `--base-url <url>` | `IMAGE_BASE_URL` | Provider inference endpoint |
| `--foundry-project-endpoint <url>` | `IMAGE_FOUNDRY_PROJECT_ENDPOINT` | Foundry project endpoint used for deployment discovery |
| `--deployment <name>` | `IMAGE_DEPLOYMENT` | Azure default deployment |
| `--transport <mode>` | `IMAGE_MCP_TRANSPORT` | `http` \| `stdio` |
| `--port <number>` | `IMAGE_PORT` | HTTP listen port |
| `--log-level <level>` | `IMAGE_LOG_LEVEL` | `debug` \| `info` \| `warn` \| `error` |
| `--api-key-file <path>` | `IMAGE_API_KEY_FILE` | Path to a file containing the provider API key |
| `--mcp-api-key-file <path>` | `IMAGE_MCP_API_KEY_FILE` | Path to a file containing the MCP bearer token |
| `--no-elicitation` | `IMAGE_USE_ELICITATION=false` | Disable MCP Elicitation |
| `--no-sampling` | `IMAGE_USE_SAMPLING=false` | Disable MCP Sampling |

**Rejected — secrets are never accepted as raw CLI values:**

| Flag | Result |
|------|--------|
| `--api-key <value>` | Parse error; exits 1 with guidance to use `--api-key-file <path>` or `IMAGE_API_KEY_FILE` |
| `--mcp-api-key <value>` | Parse error; exits 1 with guidance to use `--mcp-api-key-file <path>` or `IMAGE_MCP_API_KEY_FILE` |

This keeps API keys and bearer tokens out of shell history, `ps`/`/proc` process listings, and
Docker/`docker inspect` argv dumps. Only a file **path** is ever accepted on the command line —
never the secret value itself.

### Safe secret file examples

`--api-key-file` / `--mcp-api-key-file` (and their `IMAGE_API_KEY_FILE` /
`IMAGE_MCP_API_KEY_FILE` env equivalents) only ever take a filesystem **path** — the file
contents (the actual secret) are read by the server at startup, never echoed, and never placed
on argv:

```bash
# Create a secret file with owner-only permissions — do this once, out of shell history
# by using a heredoc or an editor, not `echo "sk-..." > file` in an interactive shell.
install -m 600 /dev/stdin /run/secrets/image_api_key <<'EOF'
sk-REPLACE_WITH_YOUR_REAL_KEY
EOF

# The CLI/env only ever reference the path:
bin/start.sh --provider openai --api-key-file /run/secrets/image_api_key
# or equivalently:
IMAGE_API_KEY_FILE=/run/secrets/image_api_key bin/start.sh --provider openai
```

Never pass `--api-key sk-...` or `IMAGE_API_KEY=sk-...` on a command line you don't fully
control (shared shells, CI logs, `docker run -e`) — prefer the `_FILE` variants everywhere
above local/dev experimentation.

### Goose configuration

Goose must invoke the **absolute path** to `bin/start.sh` (see §4.10 — required so
`reflect-metadata`/`bunfig.toml` resolve correctly), passing provider flags as args and
referencing a secret file path — never a raw key — for authentication:

```yaml
extensions:
  gpt-image-mcp:
    cmd: /abs/path/to/gpt-image-mcp/bin/start.sh
    args:
      - --provider
      - azure
      - --deployment
      - gpt-image-2
      - --api-key-file
      - /abs/path/to/secrets/image_api_key
      - --transport
      - stdio
```

`bin/start.sh` forwards all `args` verbatim to `bun run src/main.ts "$@"` after `cd`-ing to the
project root, and defaults `IMAGE_MCP_TRANSPORT=stdio` if the host omits it — see
[`examples/goose-config.yaml`](../examples/goose-config.yaml) for complete variants.

### stdio example

```bash
bin/start.sh --transport stdio --provider azure --deployment gpt-image-2 \
  --api-key-file /run/secrets/image_api_key
```

### HTTP example

```bash
bin/start.sh --transport http --port 3000 --provider openai \
  --api-key-file /run/secrets/image_api_key
```

### Docker

```bash
docker build -t gpt-image-mcp .

# Local/dev only — env-var injection leaks the key into `docker inspect` / process listings
docker run -p 3000:3000 \
  -e IMAGE_PROVIDER=openai \
  -e IMAGE_API_KEY_FILE=/run/secrets/image_api_key \
  -v /host/path/to/image_api_key:/run/secrets/image_api_key:ro \
  gpt-image-mcp

# Docker/Swarm/Compose secrets (preferred): mount under /run/secrets/ and reference by path
docker run -p 3000:3000 \
  --secret image_api_key \
  -e IMAGE_PROVIDER=openai \
  -e IMAGE_API_KEY_FILE=/run/secrets/image_api_key \
  gpt-image-mcp
```

### Docker secret guidance

- Prefer mounting a secret file and pointing `IMAGE_API_KEY_FILE` (or `--api-key-file`) at it —
  e.g. Docker/Swarm/Compose secrets mounted under `/run/secrets/`.
- Plain env-var injection (`-e IMAGE_API_KEY=sk-...`) works but leaks the key into
  `docker inspect` and process listings — acceptable for local/dev only.
- `IMAGE_MCP_SECRET_BACKEND=keytar` is **not** usable in most containers (no OS keychain) —
  stick to `file` (default) in Docker.

### Azure image deployment routing

IMAGE_DEPLOYMENT (or --deployment) selects the default Azure deployment. The server routes omitted model requests to that default, model MAI-Image-2.5 to the Microsoft MAI /mai/v1 adapter, and model gpt-image-2 to the Azure OpenAI-compatible endpoint. Unknown values fail before inference. provider_list reports the effective default and selectable models. MAI and GPT contracts are validated before network I/O.

See Azure deployment troubleshooting in authentication/TROUBLESHOOTING.md.

---

*Generated: 2026-04-22 — gpt-image-mcp project bootstrap*
