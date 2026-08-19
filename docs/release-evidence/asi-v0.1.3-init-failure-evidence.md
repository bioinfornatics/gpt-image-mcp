# gpt-image-mcp-asi — v0.1.3 initialization failure: docs-only evidence

Status: candidate evidence, issue left OPEN pending review.

## Summary

Root-caused and documented (docs-only patch, no source changes) the v0.1.3 Goose
initialization failure reported as:

```
TypeError: undefined is not an object (evaluating 'descriptor.value')
```

## Root cause

Occurs only when the extension is configured to launch the source tree directly
(`cmd: bun`, `args: ["run", "<abs>/src/main.ts"]`) rather than via the packaged `npx`
distribution or `bin/start.sh`. The MCP host (Goose) spawns the child process from its
own working directory. Bun resolves `bunfig.toml` — which preloads `reflect-metadata` —
relative to the process CWD, not the script path. Without that preload, NestJS
decorators call `Reflect.defineMetadata()` before `Reflect` has been patched, crashing on
the first decorated class evaluated at import time. Confirmed consistent with existing
project hint §4.10 ("bun run <absolute-path> crashes with reflect-metadata not loaded")
and the existing `bin/start.sh` header comment, which independently document the same
mechanism.

## Fix applied

Docs-only patch to `docs/HOWTO_GOOSE.md`:

- New "v0.1.3 initialization failure (bin/start.sh launch mode)" subsection under
  Troubleshooting, added just before "## HTTP deployments".
- Explains the cwd/bunfig.toml/reflect-metadata mechanism in plain language.
- Recommends upgrading to the packaged npx distribution pinned at `@0.1.4` (current
  `package.json` version) as the preferred resolution — it has no bunfig.toml/cwd
  dependency at all.
- For local-clone/dev use, documents launching via an **absolute path** to
  `bin/start.sh` (`cmd: /ABSOLUTE/PATH/.../bin/start.sh`, `args: []`), explicitly warning
  against relative paths and against `cmd: bun` + `args: ["run", "src/main.ts"]`.
- Documents credential configuration for both launch modes: `IMAGE_PROVIDER` (+
  Azure-specific vars) as plain `envs:` values; the actual API key via either
  `env_keys: [IMAGE_API_KEY]` resolved through Goose's `goose configure`
  keyring/secret store, or `IMAGE_API_KEY_FILE` + `IMAGE_MCP_SECRET_BACKEND: file` for
  disk-provisioned secrets. No raw secret values appear anywhere in the example.
- Reiterates that `IMAGE_MCP_API_KEY` (bearer token) is not required for `stdio`
  transport — it only gates `IMAGE_MCP_TRANSPORT=http`.
- All example snippets are copy-paste safe: no raw API keys, only placeholders
  (`/ABSOLUTE/PATH/TO/gpt-image-mcp/bin/start.sh`, `YOUR-RESOURCE`, etc.) consistent with
  the pre-existing examples in the same file.

## Files changed

- `docs/HOWTO_GOOSE.md` (new subsection only; no other content altered)
- `docs/release-evidence/asi-v0.1.3-init-failure-evidence.md` (this file)

No source files (`src/**`) were modified. No tests were added/changed (docs-only task).

## Verification

- Manual review of new markdown section for internal consistency with existing
  `bin/start.sh` script and AGENTS.md §4.10.
- `git diff --stat` confirms only the two files above changed.

## Status / next step

Candidate evidence recorded. Issue `gpt-image-mcp-asi` intentionally left **OPEN** per
task instructions — a reviewer should confirm wording/placement before closing.
