# Milestones & User Stories — gpt-image-mcp

> Managed via Beads issue tracker. This document is the human-readable companion.  
> All stories follow TDD: tests MUST exist before implementation begins.

---

## Milestone Overview

| # | Milestone | Goal | Target |
|---|-----------|------|--------|
| M1 | Foundation | Project scaffold, CI, contracts | Week 1 |
| M2 | MCP Core | Server + transports + provider config | Week 2 |
| M3 | Image Tools | All 3 image tools fully working | Week 3-4 |
| M4 | MCP Advanced | Elicitation, Sampling, Roots | Week 5 |
| M5 | Production Ready | Security hardening, observability, rate limiting | Week 6 |
| M6 | Container & Delivery | Docker, CI/CD, Helm | Week 7 |

---

## M1 — Foundation

**Goal:** Lay the groundwork. Everything that must exist before any real code is written.

### US-001 — Project Scaffold
**As a** backend engineer  
**I want** a working Bun + NestJS project skeleton with TypeScript strict mode  
**So that** I can start implementing modules with a consistent structure

**Acceptance Criteria:**
- [ ] `bun install` succeeds
- [ ] `bun run build` produces a `dist/` directory
- [ ] `bun run test` runs (zero tests, zero failures)
- [ ] `bun run lint` passes with zero warnings
- [ ] `bun run start` starts the app and logs "Application started"
- [ ] `.env.example` documents all required environment variables
- [ ] `src/` follows the module structure defined in ARCHITECTURE.md

**TDD Note:** Write a smoke test `app.spec.ts` that asserts the app bootstraps successfully — before writing `AppModule`.

---

### US-002 — CI Pipeline
**As a** DevOps engineer  
**I want** a GitHub Actions CI pipeline that runs on every push and PR  
**So that** quality gates are enforced automatically

**Acceptance Criteria:**
- [ ] Pipeline runs: lint → type-check → unit tests → build
- [ ] Pipeline fails the PR if any step fails
- [ ] Coverage report uploaded as an artifact
- [ ] Pipeline runs on `ubuntu-latest` with Bun installed
- [ ] Secrets are injected via GitHub Secrets (never hardcoded)

**TDD Note:** Write a test that asserts the CI config file is valid YAML and contains required steps.

---

### US-003 — Environment Configuration Module
**As a** backend engineer  
**I want** a validated configuration module that reads env vars at startup  
**So that** the app fails fast with a clear error if required config is missing

**Acceptance Criteria:**
- [ ] `ConfigModule` validates all required env vars using class-validator/Joi
- [ ] Missing `PROVIDER` → app refuses to start with message: "PROVIDER is required (openai|azure)"
- [ ] Missing provider credentials → app refuses to start with provider-specific message
- [ ] All config values accessible via injected `ConfigService`
- [ ] Unit test: missing `PROVIDER` triggers validation error
- [ ] Unit test: all required fields present → no error

**TDD Note:** Write failing tests for each missing-config scenario before implementing `ConfigModule`.

---

## M2 — MCP Core

**Goal:** A running MCP server that clients can connect to, with provider configuration validated.

### US-004 — Streamable HTTP Transport
**As a** backend engineer  
**I want** the MCP server to listen on a Streamable HTTP endpoint  
**So that** multiple MCP clients can connect simultaneously

**Acceptance Criteria:**
- [ ] `POST /mcp` accepts JSON-RPC 2.0 MCP requests
- [ ] `initialize` handshake returns correct capabilities
- [ ] `tools/list` returns the tool registry (initially empty, populated in M3)
- [ ] `PORT` env var controls the listening port (default: 3000)
- [ ] `MCP_API_KEY` env var, if set, requires `Authorization: Bearer <key>` header
- [ ] Integration test: `initialize` → `tools/list` returns 200 with valid MCP response
- [ ] Integration test: missing/wrong API key returns 401

**TDD Note:** Write the integration test for the initialize handshake first.

---

### US-005 — stdio Transport
**As a** backend engineer  
**I want** the MCP server to support stdio transport  
**So that** it can be used as a subprocess by local MCP clients (Claude Desktop)

**Acceptance Criteria:**
- [ ] `MCP_TRANSPORT=stdio` switches to stdio mode
- [ ] Server does NOT log to stdout (only stderr) in stdio mode
- [ ] `initialize` handshake works over stdio
- [ ] Unit test: transport factory creates correct transport based on `MCP_TRANSPORT`

---

### US-006 — MCP Capabilities Declaration
**As a** software architect  
**I want** the server to correctly declare its MCP capabilities  
**So that** clients know what protocol features to use

**Acceptance Criteria:**
- [ ] `initialize` response includes `tools: {}` capability
- [ ] `initialize` response includes `elicitation: { form: {}, url: {} }` when elicitation is enabled
- [ ] `initialize` response includes `sampling: {}` declaration (server requests sampling from client)
- [ ] Capabilities are configurable (can disable elicitation/sampling via env vars)
- [ ] Unit test: capability object matches expected structure per MCP spec

---

### US-007 — OpenAI Provider Adapter
**As a** backend engineer  
**I want** an OpenAI provider adapter that wraps the `openai` npm SDK  
**So that** image generation calls are routed to OpenAI's API

**Acceptance Criteria:**
- [ ] `OpenAIProvider` implements `IImageProvider` interface
- [ ] Uses `OPENAI_API_KEY` and optional `OPENAI_BASE_URL` from config
- [ ] `generate()` calls `client.images.generate()` with mapped parameters
- [ ] `edit()` calls `client.images.edit()` with mapped parameters
- [ ] `validate()` calls a lightweight API check (models list or images/generations with minimal params)
- [ ] API key is NEVER logged (unit test asserts this)
- [ ] Unit test (mocked HTTP): valid call → `ImagesResponse` returned
- [ ] Unit test (mocked HTTP): 429 → `RateLimitError` thrown with retry guidance
- [ ] Unit test (mocked HTTP): 401 → `AuthenticationError` thrown with clear message

**TDD Note:** Write tests against a mock HTTP server before implementing the adapter.

---

### US-008 — Azure OpenAI Provider Adapter
**As a** backend engineer  
**I want** an Azure OpenAI provider adapter  
**So that** image generation calls can be routed to Azure AI Foundry

**Acceptance Criteria:**
- [ ] `AzureOpenAIProvider` implements `IImageProvider` interface
- [ ] Uses `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`
- [ ] Uses `AzureOpenAI` client from `openai` npm package
- [ ] Deployment name is used as the model identifier in API calls
- [ ] API version defaults to `2025-04-01-preview`
- [ ] Unit tests mirror US-007 tests with Azure-specific config
- [ ] Unit test: missing `AZURE_OPENAI_ENDPOINT` → validation error at startup

---

## M3 — Image Tools

**Goal:** All three image tools (`image_generate`, `image_edit`, `image_variation`) fully functional and tested.

### US-009 — image_generate Tool
**As an** MCP client  
**I want** to call `image_generate` with a prompt  
**So that** I receive a base64-encoded image and metadata

**Acceptance Criteria:**
- [ ] Tool registered with correct Zod input schema (all parameters from FR-001)
- [ ] Tool registered with correct annotations (`readOnlyHint: false`, etc.)
- [ ] Returns base64 image(s) in markdown format by default
- [ ] Returns structured JSON when `response_format: json`
- [ ] `save_to_workspace: true` saves image to workspace root (M4 dependency, graceful fallback)
- [ ] Streaming mode returns partial images as progress
- [ ] Unit test: valid prompt → correct API call parameters
- [ ] Unit test: `n > 10` → Zod validation error
- [ ] Unit test: prompt > 32000 chars → Zod validation error
- [ ] Unit test: `n > 10` with any model → validation error surfaced clearly
- [ ] Integration test: full tool call → mocked OpenAI → base64 image returned
- [ ] Tool description is comprehensive (see SPECIFICATION.md FR-001)

---

### US-010 — image_edit Tool
**As an** MCP client  
**I want** to call `image_edit` with an image, optional mask, and prompt  
**So that** I receive an edited version of the image

**Acceptance Criteria:**
- [ ] Tool registered with correct Zod input schema (FR-002)
- [ ] Accepts base64-encoded image and mask
- [ ] Accepts file path (resolved against workspace root if available)
- [ ] Returns edited image(s)
- [ ] Unit test: valid call → correct API parameters mapped
- [ ] Unit test: invalid base64 → clear error message
- [ ] Integration test: full tool call → mocked API → edited image returned

---

### US-011 — image_variation Tool
**As an** MCP client  
**I want** to call `image_variation` with an existing image  
**So that** I receive a variation of that image

**Acceptance Criteria:**
- [ ] Tool registered with correct Zod input schema (FR-003)
- [ ] Only valid for `dall-e-2` (other models return clear error)
- [ ] Returns variation image(s)
- [ ] Unit test: non-dall-e-2 model → returns error "image_variation only supports dall-e-2"
- [ ] Integration test: full tool call → mocked API → variation returned

---

### US-012 — provider_list and provider_validate Tools
**As an** MCP client  
**I want** to query provider status  
**So that** I know which providers are available before generating images

**Acceptance Criteria:**
- [ ] `provider_list` returns all configured providers with status
- [ ] `provider_validate` tests connectivity and returns pass/fail with details
- [ ] Unit tests for both tools
- [ ] Validate result includes model availability information

---

## M4 — MCP Advanced Features

**Goal:** Elicitation, Sampling, and Roots integrated into image tools.

### US-013 — MCP Elicitation Integration
**As an** MCP server  
**I want** to request clarifying parameters from the user when a tool call is ambiguous  
**So that** image generation results match user intent

**Acceptance Criteria:**
- [ ] Elicitation only triggered when client declares `elicitation` capability
- [ ] Elicitation only sent during active `tools/call` requests (never standalone)
- [ ] Form mode requests: image style, aspect ratio, quality level
- [ ] URL mode used for any credential-related interactions (login flows)
- [ ] Server NEVER requests passwords, API keys, or secrets via form mode
- [ ] Unit test: elicitation request schema is valid per MCP spec
- [ ] Unit test: capability not declared → elicitation skipped gracefully
- [ ] Integration test: ambiguous call → elicitation → user response → image generated
- [ ] Security test: form mode schema contains no password/secret fields

---

### US-014 — MCP Sampling Integration
**As an** MCP server  
**I want** to use the client LLM to enhance image prompts before calling the API  
**So that** image quality improves without requiring server-side LLM credentials

**Acceptance Criteria:**
- [ ] Sampling only triggered when client declares `sampling` capability
- [ ] Sampling only sent during active `tools/call` requests
- [ ] Sampling request asks LLM to produce a detailed, specific image generation prompt
- [ ] Sampling result replaces (or augments) the original prompt before API call
- [ ] Sampling is opt-in (controlled by `USE_SAMPLING` env var, default: true)
- [ ] Unit test: sampling request message format is correct per MCP spec
- [ ] Unit test: sampling disabled → original prompt used directly
- [ ] Integration test: sampling → enriched prompt → better API call

---

### US-015 — MCP Roots Integration
**As an** MCP server  
**I want** to discover the client's workspace roots  
**So that** generated images can be saved to the user's project directory

**Acceptance Criteria:**
- [ ] `roots/list` sent during tool call when `save_to_workspace: true`
- [ ] Only triggered when client declares `roots` capability
- [ ] Images saved to first matching root directory with timestamped filename
- [ ] File path returned in tool result
- [ ] Unit test: roots/list response mapped to workspace path correctly
- [ ] Unit test: no roots capability → save_to_workspace gracefully returns base64 only
- [ ] Integration test: save_to_workspace=true → file written to mock workspace root

---

## M5 — Production Ready

**Goal:** Security hardening, observability, rate limiting, error handling polish.

### US-016 — Rate Limiting
**As a** security champion  
**I want** per-client rate limiting on the MCP endpoint  
**So that** the service is protected from abuse and excessive API costs

**Acceptance Criteria:**
- [ ] Rate limit configurable via `MAX_REQUESTS_PER_MINUTE` (default: 60)
- [ ] Exceeding rate limit returns MCP error with "rate limit exceeded" message
- [ ] Rate limit tracked per client IP (or MCP session ID)
- [ ] Unit test: 61st request within a minute → rate limit error
- [ ] Unit test: rate limit resets after the window

---

### US-017 — Structured Logging & Observability
**As a** DevOps engineer  
**I want** structured JSON logs and Prometheus metrics  
**So that** I can monitor and alert on service health

**Acceptance Criteria:**
- [ ] All logs in JSON format with: timestamp, level, traceId, message, context
- [ ] API keys NEVER appear in logs (masked to `***`)
- [ ] Prometheus metrics at `/metrics`: request count, latency, provider call count/latency, error rate
- [ ] Health endpoints: `/health/live` (always 200), `/health/ready` (200 if provider reachable)
- [ ] Unit test: log output for a tool call contains no secret values
- [ ] Integration test: `/metrics` returns valid Prometheus text format

---

### US-018 — Input Sanitisation & Error Handling Polish
**As a** security champion  
**I want** all inputs sanitised and all errors to return clean, non-leaking messages  
**So that** the service is resistant to injection and information disclosure

**Acceptance Criteria:**
- [ ] Prompt strings sanitised: null bytes removed, length enforced, encoding validated
- [ ] File paths (for image/mask) validated against workspace root (no path traversal)
- [ ] All provider errors mapped to MCP error objects (no stack traces exposed)
- [ ] Unknown tool names return standard MCP "method not found" error
- [ ] Unit test: path traversal attempt → rejected with clear error
- [ ] Unit test: null byte in prompt → sanitised or rejected

---

## M6 — Container & Delivery

**Goal:** Production-ready Docker image and CI/CD pipeline.

### US-019 — Docker Image
**As a** DevOps engineer  
**I want** a minimal, hardened OCI image  
**So that** the service can be deployed anywhere containers run

**Acceptance Criteria:**
- [ ] Multi-stage Dockerfile: build stage (full Bun) → runtime stage (slim)
- [ ] Runtime image ≤ 200 MB
- [ ] Runs as non-root user
- [ ] Health check instruction in Dockerfile
- [ ] Image passes Trivy vulnerability scan with zero HIGH/CRITICAL issues
- [ ] Supports linux/amd64 and linux/arm64
- [ ] Container test: start container → health check passes → `tools/list` call succeeds

---

### US-020 — CI/CD Pipeline & Release
**As a** DevOps engineer  
**I want** an automated pipeline that builds, tests, scans, and publishes the image  
**So that** every merge to main is deployable

**Acceptance Criteria:**
- [ ] Pipeline stages: lint → type-check → unit test → integration test → build → scan → publish
- [ ] Image tagged with git SHA and semantic version
- [ ] Published to `ghcr.io` on merge to `main`
- [ ] Release notes auto-generated from commit messages
- [ ] Secrets managed via GitHub Secrets (never in pipeline YAML)

---

## Dependency Graph

```
M1 (US-001 → US-002 → US-003)
       ↓
M2 (US-004, US-005 ← US-006, US-007, US-008)
       ↓
M3 (US-009, US-010, US-011 ← US-007/008) + (US-012)
       ↓
M4 (US-013, US-014, US-015) ← M2 capabilities
       ↓
M5 (US-016, US-017, US-018)
       ↓
M6 (US-019, US-020)
```

---

*Last updated: 2026-04-22*
