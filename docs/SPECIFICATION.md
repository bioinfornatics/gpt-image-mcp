# Project Specification — gpt-image-mcp

**Version:** 1.0.0-draft  
**Date:** 2026-04-22  
**Status:** Approved for Development  

---

## 1. Executive Summary

`gpt-image-mcp` is a production-grade **Model Context Protocol (MCP) server** that exposes AI image generation capabilities to any MCP-compatible LLM client. It wraps the OpenAI and Azure OpenAI `gpt-image-*` API families and implements advanced MCP protocol features — Elicitation, Sampling, and Roots — to enable interactive, context-aware image generation workflows.

**Stack:** Bun (runtime) + NestJS (framework) + TypeScript (language)  
**Protocol:** MCP draft specification (2025-11)  
**Methodology:** Test-Driven Development (TDD)

---

## 2. Problem Statement

LLM clients (Claude Desktop, Goose, Cursor, etc.) lack a standardised, secure, and configurable bridge to high-quality image generation APIs. Existing integrations are:
- Tightly coupled to a single provider
- Insecure (API keys in prompts or configs)
- Missing interactive refinement (the model must guess missing parameters)
- Unable to save outputs into the user's workspace

`gpt-image-mcp` solves all four problems.

---

## 3. Goals & Non-Goals

### Goals
- ✅ Implement a fully spec-compliant MCP server (Streamable HTTP + stdio transports)
- ✅ Support OpenAI and Azure OpenAI image APIs (`gpt-image-2`, `gpt-image-1.5`, `gpt-image-1-mini`, `gpt-image-1`; `dall-e-2` for variations only; ~~`dall-e-3`~~ retired 2026-03-04)
- ✅ Expose tools: `image_generate`, `image_edit`, `image_variation`, `provider_list`, `provider_validate`
- ✅ Implement MCP Elicitation for interactive parameter refinement
- ✅ Implement MCP Sampling for prompt enhancement via client LLM
- ✅ Implement MCP Roots for workspace-aware file saving
- ✅ Follow strict TDD (tests written before implementation)
- ✅ Full observability: structured logging, Prometheus metrics, health endpoints
- ✅ Container-ready OCI image

### Non-Goals
- ❌ Building a custom image generation model
- ❌ Providing a web UI / user-facing front-end
- ❌ Managing OpenAI account billing or quotas
- ❌ Supporting image models outside the OpenAI ecosystem (Stable Diffusion, Midjourney, etc.) — *future roadmap*

---

## 4. Stakeholders

| Stakeholder | Interest |
|-------------|---------|
| LLM Client Developers | Reliable MCP server to call image generation |
| End Users | High-quality images generated in-context |
| DevOps/Platform Teams | Deployable, observable, secure service |
| Security Teams | Secret hygiene, no credential leakage |

---

## 5. System Overview

The server acts as a **protocol bridge**:

```
MCP Client → [JSON-RPC 2.0 over HTTP/stdio] → gpt-image-mcp → [HTTPS REST] → OpenAI/Azure
```

Key integration points:
1. **MCP Transport**: Streamable HTTP (default, multi-client) or stdio (single-client, local)
2. **Provider Layer**: Pluggable provider abstraction over `openai` npm SDK
3. **MCP Client Features**: Server sends `elicitation/create`, `sampling/createMessage`, `roots/list` back to the client during tool execution
4. **Security Layer**: All API credentials from environment variables; input sanitisation; rate limiting

---

## 6. Functional Requirements

### FR-001: Image Generation Tool
- **Tool name:** `image_generate`
- **Description:** Generate one or more images from a text prompt
- **Inputs:**
  - `prompt` (string, required, max 32 000 chars)
  - `model` (enum, optional, default: `gpt-image-2`)
  - `n` (integer 1–10, optional, default: 1)
  - `size` (enum: `auto|1024x1024|1536x1024|1024x1536|256x256|512x512|1792x1024|1024x1792`, optional, default: `auto`)
  - `quality` (enum: `auto|high|medium|low|hd|standard`, optional, default: `auto`)
  - `background` (enum: `auto|transparent|opaque`, optional, GPT image models only)
  - `output_format` (enum: `png|jpeg|webp`, optional, GPT image models only)
  - `output_compression` (integer 0–100, optional, webp/jpeg only)
  - `moderation` (enum: `auto|low`, optional, GPT image models only)
  - `save_to_workspace` (boolean, optional, default: false)
  - `response_format` (enum: `markdown|json`, optional, default: `markdown`)
- **Outputs:** Base64-encoded image(s) with metadata; optionally saves files to workspace root
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: true`, `idempotentHint: false`

### FR-002: Image Edit Tool
- **Tool name:** `image_edit`
- **Description:** Edit an existing image using an inpainting mask and prompt
- **Inputs:**
  - `image` (string, required, base64 or file path)
  - `mask` (string, optional, base64 or file path)
  - `prompt` (string, required)
  - `model` (enum, optional, supports GPT image models + dall-e-2)
  - `n`, `size`, `quality`, `output_format`, `output_compression`, `save_to_workspace`, `response_format`
- **Outputs:** Edited image(s) with metadata
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: true`, `idempotentHint: false`

### FR-003: Image Variation Tool
- **Tool name:** `image_variation`
- **Description:** Create a variation of an existing image (dall-e-2 only)
- **Inputs:**
  - `image` (string, required, base64 or file path)
  - `n` (integer 1–10, optional, default: 1)
  - `size` (enum: `256x256|512x512|1024x1024`, optional)
  - `save_to_workspace` (boolean, optional)
  - `response_format` (enum: `markdown|json`, optional)
- **Outputs:** Variation image(s) with metadata
- **Annotations:** `readOnlyHint: false`, `destructiveHint: false`, `openWorldHint: true`, `idempotentHint: false`

### FR-004: Provider List Tool
- **Tool name:** `provider_list`
- **Description:** List all configured providers and their availability status
- **Inputs:** none
- **Outputs:** Provider names, configured models, status (available/degraded/error)
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`, `idempotentHint: true`

### FR-005: Provider Validate Tool
- **Tool name:** `provider_validate`
- **Description:** Validate a provider's configuration (tests connectivity without generating an image)
- **Inputs:** `provider` (enum: `openai|azure`, required)
- **Outputs:** Validation result with error details if failed
- **Annotations:** `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: true`, `idempotentHint: true`

### FR-006: MCP Elicitation
- When `image_generate` or `image_edit` is called with ambiguous or missing parameters, the server **MAY** send an `elicitation/create` request (form mode) to collect: image style preference, aspect ratio, quality level
- Elicitation is only triggered when the client declares the `elicitation` capability
- Sensitive data (API keys, credentials) **MUST** use URL mode or be provided via environment variables only — never via form mode elicitation
- The server **MUST** send elicitation only during active tool calls (not standalone)

### FR-007: MCP Sampling
- Before calling the image API, the server **MAY** send a `sampling/createMessage` request to enhance or disambiguate the user's prompt
- Only triggered when the client declares the `sampling` capability
- The sampling request includes the original prompt and asks the LLM to produce an enriched, detailed image generation prompt
- The server **MUST** send sampling only during active tool calls (not standalone)

### FR-008: MCP Roots
- During tool execution involving `save_to_workspace: true`, the server sends `roots/list` to discover workspace directories
- Only triggered when the client declares the `roots` capability with `listChanged: true|false`
- Generated images are saved to the first matching root directory
- The server **MUST** send roots/list only during active tool calls

### FR-009: Multi-Provider Support
- The server supports OpenAI (direct) and Azure OpenAI (via AI Foundry endpoint)
- Provider is selected via `PROVIDER` environment variable
- Credentials are provider-specific (see Configuration)
- The server validates provider configuration at startup and fails fast with a clear error if configuration is missing

### FR-010: Streaming Support
- For GPT image models, the server supports streaming partial image previews
- Streaming is opt-in via the `stream` parameter (default: false)
- When streaming, partial base64 chunks are returned as MCP progress notifications

---

## 7. Non-Functional Requirements

### NFR-001: Performance
- p99 latency for tool call handling (excluding image generation API latency): < 100 ms
- Startup time: < 5 seconds
- Memory footprint at idle: < 128 MB

### NFR-002: Reliability
- Health check endpoints respond within 50 ms
- Graceful shutdown: drain in-flight requests within 30 seconds
- Automatic provider failover (if multiple providers configured): within 3 seconds

### NFR-003: Security
- API keys loaded exclusively from environment variables
- API keys MUST NOT appear in logs (masked to `***`)
- Input prompts sanitised to prevent injection into API calls
- Rate limiting: configurable per-client (default: 60 req/min)
- MCP endpoint optionally protected by a bearer token (`MCP_API_KEY`)
- All secrets validated at startup; service refuses to start without required credentials

### NFR-004: Observability
- Structured JSON logs (via NestJS Logger + Winston)
- Prometheus metrics at `/metrics`: request count, latency histograms, error rates, provider call counters
- Health endpoints: `/health/live` and `/health/ready`
- Trace IDs propagated through logs and error responses

### NFR-005: Testability (TDD)
- All business logic covered by unit tests written BEFORE implementation
- Integration tests cover provider adapters with mocked HTTP
- E2E tests cover full MCP tool call flow using MCP Inspector or test client
- Coverage target: ≥ 90% for `src/` (branches + lines)
- Mutation testing score ≥ 75%

### NFR-006: Portability
- OCI-compliant Docker image based on `oven/bun` slim
- Runs on Linux/amd64 and linux/arm64
- No hard dependency on the host filesystem (except for workspace root saves)
- 12-factor app: configuration via environment, stateless processes

---

## 8. Constraints

- **Runtime**: Bun ≥ 1.1 (native TypeScript execution, fast startup, Node.js-compatible)
- **Framework**: NestJS ≥ 10 (dependency injection, modular architecture, testability)
- **Protocol**: MCP TypeScript SDK v1.x (production-stable; v2 is pre-alpha)
- **Language**: TypeScript strict mode
- **No secrets in code**: ESLint rule + pre-commit hook to detect secrets
- **All provider API calls via official SDK**: `openai` npm package (covers both OpenAI and Azure)

---

## 9. Assumptions

1. Callers are MCP-compatible clients that speak JSON-RPC 2.0
2. Image generation latency is provider-dependent and outside the server's control
3. The `openai` npm SDK handles Azure OpenAI via `AzureOpenAI` client class
4. `gpt-image-2` is available on Azure but may be limited access; the server handles 403/404 gracefully
5. Base64 image data may be large (several MB); clients must handle large MCP responses

---

## 10. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Provider API changes (OpenAI) | High | Medium | Pin `openai` SDK version; monitor changelogs |
| `gpt-image-2` limited access on Azure | Medium | High | Graceful degradation; clear error message |
| MCP spec still evolving (elicitation/sampling) | Medium | Medium | Abstract behind interfaces; easy to adapt |
| Large base64 payloads causing memory pressure | Medium | Medium | Stream where possible; add response size guard |
| Secret leakage in logs | High | Low | Mandatory log masking tests |
| Rate limiting by OpenAI | Medium | High | Retry with exponential backoff + jitter |

---

## 11. Acceptance Criteria (per Feature)

These are checked by QA before a feature is marked Done.

| Feature | Acceptance Criteria |
|---------|---------------------|
| image_generate | Returns valid base64 image for valid prompt; returns structured error for invalid model; prompt > max length rejected |
| image_edit | Returns edited image; rejects mismatched image/mask sizes |
| image_variation | Returns variation; returns error for non-dall-e-2 model |
| provider_list | Lists all configured providers with correct status |
| provider_validate | Returns success for valid config; clear error for missing/wrong key |
| Elicitation | Form mode triggered for ambiguous call; never requests secrets via form mode |
| Sampling | Prompt enriched before API call when capability declared |
| Roots | Images saved to correct workspace root when save_to_workspace=true |
| Security | API key never in logs; rate limit enforced; invalid inputs rejected |
| Docker | Container starts, health check passes, tool call succeeds |

---

## 12. Glossary

| Term | Definition |
|------|-----------|
| MCP | Model Context Protocol — open standard for LLM-tool communication |
| Elicitation | MCP feature allowing servers to request structured input from users |
| Sampling | MCP feature allowing servers to request LLM completions from the client |
| Roots | MCP feature exposing client filesystem directories to the server |
| Tool | An MCP-registered function callable by LLM clients |
| Provider | An image generation API backend (OpenAI, Azure OpenAI) |
| Transport | The communication channel (Streamable HTTP or stdio) |
| Streamable HTTP | MCP transport over HTTP with optional streaming |
| TDD | Test-Driven Development — tests written before production code |

---

*Specification approved by: Software Architect — 2026-04-22*
