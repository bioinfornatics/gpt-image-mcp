# gpt-image-mcp

> **A production-grade MCP (Model Context Protocol) service for AI image generation**, built on **Bun + NestJS**, supporting OpenAI and Azure OpenAI `gpt-image-*` models.

[![MCP Spec](https://img.shields.io/badge/MCP-draft%202025--11-blue)](https://modelcontextprotocol.io/specification/draft)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)
[![NestJS](https://img.shields.io/badge/framework-NestJS-red)](https://nestjs.com)
[![TDD](https://img.shields.io/badge/methodology-TDD-green)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)]()

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

- **OpenAI** (`/v1/images/generations` — `gpt-image-1`, `gpt-image-1.5`, `gpt-image-1-mini`, `dall-e-3`, `dall-e-2`)
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
  -e PROVIDER=openai \
  -e OPENAI_API_KEY=sk-... \
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
        "PROVIDER": "openai",
        "OPENAI_API_KEY": "sk-..."
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
| `PROVIDER` | ✅ | — | `openai` or `azure` |
| `OPENAI_API_KEY` | if openai | — | OpenAI secret key |
| `OPENAI_BASE_URL` | ❌ | `https://api.openai.com/v1` | Override base URL |
| `AZURE_OPENAI_ENDPOINT` | if azure | — | e.g. `https://my-res.openai.azure.com` |
| `AZURE_OPENAI_API_KEY` | if azure | — | Azure resource key |
| `AZURE_OPENAI_DEPLOYMENT` | if azure | — | Deployment name |
| `AZURE_OPENAI_API_VERSION` | if azure | `2025-04-01-preview` | API version |
| `DEFAULT_MODEL` | ❌ | `gpt-image-1` | Default image model |
| `MCP_TRANSPORT` | ❌ | `http` | `http` or `stdio` |
| `PORT` | ❌ | `3000` | HTTP server port |
| `MCP_API_KEY` | ❌ | — | Protect the MCP endpoint |
| `LOG_LEVEL` | ❌ | `info` | `debug|info|warn|error` |
| `MAX_REQUESTS_PER_MINUTE` | ❌ | `60` | Rate limit per client |

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
| OpenAI | `gpt-image-1`, `gpt-image-1.5`, `gpt-image-1-mini`, `dall-e-3`, `dall-e-2` | Direct API |
| Azure OpenAI | `gpt-image-1`, `gpt-image-1.5`, `gpt-image-2`, `dall-e-3` | Via AI Foundry deployment |

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

*Generated: 2026-04-22 — gpt-image-mcp project bootstrap*
