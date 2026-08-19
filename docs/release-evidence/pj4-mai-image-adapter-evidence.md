# gpt-image-mcp-pj4 — MAI Image adapter implementation evidence

**Date:** 2026-08-19
**Scope:** Dedicated MAI Image (`MAI-Image-2.5`) adapter, discovery integration, tests, quality gate.

## What was implemented

- `src/providers/mai-image.provider.ts` — new `MaiImageProvider` implementing `IImageProvider`:
  - `POST {endpoint}/mai/v1/images/generations` and `/mai/v1/images/edits`
  - JSON body: `{ model: <exact deployment>, prompt, width, height[, image] }`
  - Output always validated as PNG; base64 decoded via existing `image-media.ts`
  - `quality` explicitly rejected (throws) unless absent/`"auto"` — Microsoft's MAI Image
    docs do not document any quality parameter (including `quality=low`)
  - `width`/`height` validated: both `>= 768`, total pixels `<= 1,048,576`
  - `variation()` explicitly unsupported (throws actionable error)
- `src/providers/azure-deployment-registry.ts` — added `isMaiImageDeployment()` helper
  (exact match `MAI-Image-2.5`, case-insensitive) used purely for **routing**, not
  capability inference. The OpenAI-compatible registry (`KNOWN_AZURE_DEPLOYMENTS`)
  deliberately still excludes `MAI-Image-2.5` since that model is never sent through
  `AzureStrategy`/OpenAI SDK.
- `src/providers/providers.module.ts` — routes `IMAGE_PROVIDER=azure` + `IMAGE_DEPLOYMENT`
  resolving to `MAI-Image-2.5` to `MaiImageProvider` (reusing the existing
  `AzureOpenAIClientFactory.createAuthHeaderProvider()` for shared api-key/Bearer auth),
  before the pre-existing `AzureStrategy`/`RequestAwareAzureProvider` path.
- `src/config/models.ts` — added `MAI-Image-2.5` (Public Preview) to `AZURE_MODELS`.
- Pre-existing `AzureDeploymentCatalog` (deployment discovery, `GET
  {endpoint}/deployments?api-version=v1`) was **not duplicated** — reused as-is for
  model-family/name discovery; `IMAGE_DEPLOYMENT` remains the supported explicit selector.
- Fixed a pre-existing `tsc` blocker in `src/providers/strategies/azure.strategy.ts`
  (TS2729 "Property 'catalog' used before its initialization" from a class-field
  initializer referencing `this.catalog`) by converting `resolveModelAsync` to a getter.
  Unrelated to MAI Image but blocked `bun run type-check` for the whole repo.

## Tests added

- `test/unit/providers/mai-image.provider.spec.ts` — 20 unit tests, HTTP fully mocked
  (`fetch` injected), covering: size validation (min edge, max pixels, malformed),
  quality rejection, generate/edit request shape, HTTP error mapping (401/403/404/429),
  empty-payload / non-PNG rejection, variation unsupported, validate(), network failure
  masking.
- `test/integration/providers/mai-image.provider.live.integration.spec.ts` — **gated**
  live integration test:
  - Skipped entirely (`describe.skipIf`) when no local `API_KEY` file exists at the
    project root — never fails CI/sandboxes without credentials.
  - When present: (1) live `GET
    https://servier-difa-foundry-nprd.services.ai.azure.com/api/projects/servier-difa-foundry-nprd-project/deployments?api-version=v1`
    discovery call, (2) one minimal 1024x1024 `MAI-Image-2.5` generation.
  - All error paths pass through `maskSecret()`; the generated image base64 is never
    logged, written to disk, or asserted beyond `format === 'png'`.

## Live run results (this session, key present but redacted)

| Check | Result |
|---|---|
| Discovery `GET .../deployments?api-version=v1` | **HTTP 200** |
| Deployments discovered (names only, no other metadata retained here) | `gpt-5.2-codex, text-embedding-3-small, claude-sonnet-4-6, gpt-image-2, gpt-5.5, gpt-5.6-sol, claude-sonnet-5, DeepSeek-V4-Flash, gpt-5.6-luna, MAI-Image-2.5, MAI-Thinking-1, MAI-Image-2.5-Flash` |
| MAI generation `POST /mai/v1/images/generations` (model=`MAI-Image-2.5`, 1024x1024) | **Success** — response contained a `png` payload; not persisted, not logged |

No API key, token, or any secret value is included above or was written to any file,
log, or Beads note.

## Quality gate

```
bun test          → 740 pass, 1 skip (guard test), 0 fail (741 total)
bun run type-check → clean
bun run lint       → 0 errors, 102 pre-existing `no-explicit-any` warnings (unchanged scope)
bun run build      → succeeds (dist/main.js emitted, chmod +x)
```

## Follow-ups left for verifier

- Confirm whether `MaiImageProvider.validate()` should attempt a live reachability
  check (Microsoft does not document a model-listing endpoint for `/mai/v1`, so this
  adapter only validates configuration shape today, unlike `AzureStrategy.validate()`).
- Confirm `n > 1` handling for MAI Image generate/edit — the docs snippet reviewed did
  not confirm multi-image request semantics; current code forwards `n` only when > 1
  and lets the API reject it if unsupported.
- Consider adding `resolveModelAsync`-based catalog routing for `MaiImageProvider`
  itself (currently only `AzureStrategy` uses the catalog for name resolution);
  `MaiImageProvider` today only reads the static `IMAGE_DEPLOYMENT` config value.
