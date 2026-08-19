# Azure multi-deployment routing evidence

Date: 2026-08-19

## Delivered behavior

- `IMAGE_DEPLOYMENT=MAI-Image-2.5` is the runtime default.
- Omitting `model` routes generation/editing to the MAI `/mai/v1` adapter.
- Explicit `model=gpt-image-2` routes to the deployed Azure OpenAI-compatible endpoint.
- MCP schemas preserve an omitted model; provider defaults are applied inside the tools before model-aware validation.
- `provider_list` reports the runtime default and selectable deployed models.
- Unknown models fail before inference.
- Azure deployment pagination rejects cross-origin `nextLink` URLs and loops before forwarding credentials.

## Live verification

Using the local ignored `API_KEY` and the configured Foundry resource, with returned image bytes discarded:

- omitted model → `{ ok: true, model: "MAI-Image-2.5", format: "png", count: 1 }`
- explicit `gpt-image-2` → `{ ok: true, model: "gpt-image-2", format: "png", count: 1 }`

No image payload or credential was logged or persisted.

## Quality gate

- tests: 754 pass / 2 skip / 0 fail
- lint: 0 errors (103 existing warnings)
- type-check: clean
- build: clean
