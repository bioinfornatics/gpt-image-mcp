# MAI-Image-2.5 safety diagnostics evidence

Date: 2026-08-19

## Finding

The observed HTTP 400 errors are genuinely classified by the MAI provider as `content_safety_violation`, but they do not prove that the user's prompt itself is unsafe. The provider messages explicitly said `Response content blocked by label ...`, which is evidence of generated-response/candidate filtering. Different image models and repeated generations can produce different candidates and therefore different filter outcomes.

## Controlled live probes

Only safe status/error metadata and Azure request IDs were logged; returned image bytes were discarded.

- Microsoft.ai-style rooftop bubble prompt: HTTP 400, `content_safety_violation`, `Response content blocked by label 'MultiSeverity_SexualScore'`, request `2d8b8b15-af0c-4a63-b79b-2c28022709e4`.
- Neutral adult office prompt: HTTP 200, one image.
- Minimal blue cup prompt: HTTP 200, one image.
- The exact corporate prompt that succeeded with gpt-image-2: HTTP 200 on a later MAI attempt, one image, request `bedbe9e1-e225-48e4-aaae-8818a53eb7ad`.

This proves the MAI endpoint and request schema are functional and demonstrates that at least some blocks are candidate-dependent or non-deterministic. It does not identify why a particular candidate received a specific internal label; Azure Support needs the request ID for that diagnosis.

## Product change

- Preserve allowlisted provider code, label, HTTP status, stage and request ID in a typed error.
- Infer `output` only from explicit wording such as `Response content blocked`; otherwise use `prompt` only for explicit prompt wording, or `unknown`.
- Return MCP `isError: true` plus structured error metadata and state that no image was created.
- Avoid claiming that the prompt itself is unsafe and avoid unlimited automatic retries.
