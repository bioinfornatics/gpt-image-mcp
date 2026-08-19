# pj4 — MAI-Image-2.5 integration evidence

Date: 2026-08-19

## Scope

- `MaiImageProvider` (`/mai/v1` route, exact deployment passthrough, quality
  rejection, WxH size mapping, PNG-only output) — implemented and unit tested.
- Factory/selector integration: `providers.module.ts` routes the exact,
  case-insensitive deployment `MAI-Image-2.5` to `MaiImageProvider` via
  `isMaiImageDeployment()` (`azure-deployment-registry.ts`), leaving the
  existing OpenAI-compatible Azure (`gpt-image-2`) path untouched.
- `API_KEY` secret hygiene: local credential file added to `.gitignore`
  (never tracked, never printed, never logged).
- Live integration test hardened: requires explicit `RUN_LIVE_TESTS=true`
  opt-in **in addition to** local `API_KEY` presence. A live HTTP
  401/403/404 is never treated as a pass by default — the suite is entirely
  skipped unless both conditions hold, and response bodies are never
  logged (masked or not), only HTTP status codes / known-safe identifiers.

## Quality gate (this session)

```
bun test          -> 739 pass / 2 skip / 0 fail (1269 expect() calls)
bun run type-check -> 0 errors
bun run lint       -> 0 errors, 96 pre-existing warnings (no-explicit-any in tests)
bun run build      -> succeeds (dist/main.js emitted)
```

## Opt-in live probe (RUN_LIVE_TESTS=true, local API_KEY present)

Run: `RUN_LIVE_TESTS=true bun test test/integration/providers/mai-image.provider.live.integration.spec.ts`

Result (status codes only — no response bodies, no secrets persisted or printed):

| Probe | Outcome |
|---|---|
| Discovery `GET {project}/deployments?api-version=v1` | HTTP 200 (assertion: `typeof status === 'number'`, test passed) |
| Generation `POST {endpoint}/mai/v1/images/generations` (MAI-Image-2.5, 1024x1024) | Succeeded — `format=png`, `model=MAI-Image-2.5` (test passed, image discarded, never written to disk) |

3 tests ran (2 pass, 1 skip-guard skipped since live mode was active).

## Secret hygiene confirmation

- `API_KEY` was **not** tracked by git before this session (`git rm --cached`
  reported "no such path" — confirming it was already untracked).
- `.gitignore` now explicitly excludes `API_KEY` at the repo root.
- No API key value appears in this document, in test output above, or in
  any committed file.

## Status

pj4 implementation, tests, and quality gate are complete and green. Leaving
the bd issue **open** for verifier sign-off per instructions.
