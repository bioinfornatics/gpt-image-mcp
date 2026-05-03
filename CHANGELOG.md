# Changelog

All notable changes to `@bioinfornatics/gpt-image-mcp` are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [0.1.0] — 2026-05-03

> **Major feature release.** Full `gpt-image-2` support, multi-image compositing,
> context-aware prompt enhancement, hardened security, and 481 passing tests (+164 since 0.0.2).

### Added

#### `image_generate` tool
- **`gpt-image-2` arbitrary resolution**: size now accepts any `WxH` string validated against all four API constraints (multiples of 16, max edge < 3840, ratio ≤ 3:1, pixels 655 360–8 294 400). Fixed-size presets still work unchanged.
- **`isExperimentalResolution()`**: sizes above 2 560 × 1 440 are flagged as experimental in tool output per the OpenAI guide.
- **`skip_elicitation` parameter**: set `true` to bypass the interactive quality/size form — recommended for automated pipelines.
- **`resolveModeration()` helper**: `moderation: "low"` is silently downgraded to `"auto"` unless `ALLOW_LOW_MODERATION=true` is set in the environment.

#### `image_edit` tool
- **Multi-image compositing**: new `images: string[]` parameter (1–5 base64 images) for virtual try-on, person-in-scene insertion, and general compositing. `image` (single) and `images` (array) are mutually exclusive and validated at the schema layer.
- **`input_fidelity` parameter** (`"low" | "high"`): identity-preservation control for `gpt-image-1.x` models. Automatically suppressed (not forwarded) when `model: "gpt-image-2"` to prevent API 400.
- **10 MB aggregate payload guard**: tool rejects `images[]` requests whose total decoded size exceeds 10 MB before touching the network.

#### Elicitation service
- **Redesigned form UX**: `size` shown first (more visually intuitive than quality), conversational `message` string, human-readable descriptions that name use-cases rather than raw API values.
- **Size options aligned with schema**: elicitation no longer offers sizes the Zod schema would reject.

#### Sampling service
- **Context-aware prompt enhancement**: `enhancePrompt()` now accepts a full `ImagePromptContext` (model, quality, size, output_format, background, n) resolved after elicitation, enabling context-specific prompt construction.
- **Adaptive token budget**: 80 tokens for `quality: "low"` (fast draft loop), up to 350 for `quality: "high"` + large canvas.
- **Photorealism system prompt**: structured photography vocabulary, composition cues, and explicit anti-pattern list.
- **Conditional branches**: transparent background, widescreen, portrait, ultra-wide, JPEG, and multi-variant cases each receive tailored guidance.
- **Static helpers** `resolveMaxTokens()` and `buildUserMessage()` are exported and independently unit-tested.

#### Security
- **`REQUIRE_MCP_AUTH`** env var (default `true`): `MCP_API_KEY` is now required by default. Set `REQUIRE_MCP_AUTH=false` to allow unauthenticated access for local development.
- **`detectForgeryIntent()`** in `sanitise.ts`: heuristic detection of prompts describing screenshot forgery, domain impersonation, or fabrication of official-looking documents.
- **Byte-aware rate limiting**: `RateLimitGuard` now tracks cumulative payload bytes per client window in addition to request count. Configurable via `MAX_BYTES_PER_MINUTE` (default 50 MB). Separate 429 error messages distinguish count-limit from byte-limit violations.

#### Provider interface
- `EditParams.image` changed to optional (required when `images[]` not provided).
- `EditParams.images?: string[]` added for multi-image compositing.
- `EditParams.input_fidelity?: 'low' | 'high'` added.

### Fixed

#### Schema bugs (all caused API 400 on `gpt-image-*` models)
- Removed `"hd"` and `"standard"` from `ImageGenerateSchema.quality` — DALL-E 3 tokens, retired 2026-03-04.
- Removed `"256x256"`, `"512x512"`, `"1792x1024"`, `"1024x1792"` from `ImageGenerateSchema.size` — DALL-E 2/3 sizes invalid for `gpt-image-*`.
- Removed `"standard"` from `ImageEditSchema.quality`.
- Removed `"256x256"`, `"512x512"` from `ImageEditSchema.size`.
- Elicitation size options (`SIZE_OPTIONS_GPT_IMAGE_2`) offered `"2048x2048"` and `"4096x4096"` which the schema rejected — now aligned to `['auto', '1024x1024', '1536x1024', '1024x1536']`.

#### MCP feature routing (all three features were silently no-ops)
- `ElicitationService`, `SamplingService`, and `RootsService` received `McpServer` (the outer wrapper) when they required `Server` (the inner SDK object). `McpServer` does not expose `elicitInput()`, `createMessage()`, or `listRoots()` — calls threw `TypeError` which was silently caught, degrading all M4 features to no-ops on every request.
- Fix: tools now close over `server.server` (the inner `Server`) and pass it to all feature services. `McpServerService.innerServer` getter added.
- Removed all `(server as any)` casts from feature services — methods are now correctly typed.

#### Elicitation flow issues
- Removed dead `hasStyle` parameter (interface accepted it, service never used it).
- Fixed ordering: elicitation now runs **before** sampling so quality/size context is available when the LLM enhances the prompt.

### Changed

- Default model updated to `gpt-image-2` throughout (schemas, tool descriptions, elicitation form, documentation).
- `ImageGenerateSchema.size` changed from `z.enum([...])` to `z.string().superRefine(...)` to support arbitrary `WxH` values for `gpt-image-2`. All existing preset values continue to work.
- `SamplingService.enhancePrompt()` signature changed from `(server, prompt, model: string)` to `(server, prompt, context: ImagePromptContext)`. Breaking for direct callers; tool layer updated.
- Elicitation field order: `size` shown before `quality`.

### Removed

- `PROMPT_MAX_LENGTH_DALLE3` constant (4 000 chars) — DALL-E 3 retired 2026-03-04.
- `hasStyle` parameter from `ElicitationService.requestImageParams()`.
- `"hd"`, `"standard"` from quality enums; DALL-E 2/3 sizes from generate/edit enums.

### Documentation

- `docs/API.md`: updated all model tables, size/quality reference tables, and appendix feature matrix to reflect `gpt-image-2` as primary model and DALL-E 3 retirement.
- `docs/README.md`, `docs/SPECIFICATION.md`, `docs/ARCHITECTURE.md`, `docs/MILESTONES.md`, `docs/TDD_STRATEGY.md`: DALL-E 3 references replaced with retirement notices or removed.
- `examples/goose-config.yaml`: corrected to use `bunx`, scoped package name `@bioinfornatics/gpt-image-mcp`, proper `envs:`/`env_keys:` schema, Azure as primary example.
- `README.md`: all install commands updated to scoped package name; Goose config section expanded with OpenAI and Azure variants.

### Tests

- **481 passing tests** (up from 317 at 0.0.2, +164 new).
- New test files: `test/unit/mcp/tools/schemas.spec.ts`.
- Extended: all feature service specs, all tool specs, provider edit/variation spec, rate-limit guard spec, MCP server spec.
- Coverage maintained ≥ 90% lines and functions.

---

## [0.0.2] — 2026-04-29

> **First published release.** Package available on GitHub Packages (`npm.pkg.github.com`) and npmjs.com. Docker image on `ghcr.io`.

### Added
- Initial MCP server with 5 tools: `image_generate`, `image_edit`, `image_variation`, `provider_list`, `provider_validate`.
- OpenAI and Azure OpenAI providers via `@openai/openai` SDK.
- HTTP (Streamable HTTP, stateless per-request) and stdio transports.
- MCP Elicitation, Sampling, and Roots (M4 features).
- Bearer token authentication (`MCP_API_KEY`), rate limiting, prompt sanitisation.
- Multi-platform Docker image (`linux/amd64`, `linux/arm64`).
- CI/CD pipeline: quality gate → Trivy CVE scan → GitHub Packages → npmjs.com → GitHub Release.
- Renovate dependency automation.

### Fixed
- `package.json` `files[]` tightened from `"dist/**/*"` to `"dist/**/*.js"` + `"dist/**/*.d.ts"` + `"bin/start.sh"` — removes `.tsbuildinfo` and `.map` files, tarball 710 KB → 177 KB.
- CI `publish-gpr` switched from `bun publish` to `npm publish + ~/.npmrc` — `bun publish` ignored `BUN_AUTH_TOKEN` when `publishConfig.registry` was set.

---

## [0.0.1] — 2026-04-23

> **Initial tag.** Development baseline; not published to any registry.

### Added
- Project scaffold: NestJS 10, Bun ≥ 1.1, TypeScript strict, MCP SDK v1.29.
- Core architecture: providers, tools, security, health, metrics modules.
- Secret resolution: `_FILE` env vars, keytar OS keychain, plain env (`MCP_SECRET_BACKEND`).
- GitHub Actions CI skeleton.

---

[Unreleased]: https://github.com/bioinfornatics/gpt-image-mcp/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bioinfornatics/gpt-image-mcp/compare/v0.0.2...v0.1.0
[0.0.2]: https://github.com/bioinfornatics/gpt-image-mcp/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/bioinfornatics/gpt-image-mcp/releases/tag/v0.0.1
