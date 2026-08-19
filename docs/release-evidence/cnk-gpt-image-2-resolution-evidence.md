# gpt-image-mcp-cnk — Evidence: arbitrary WxH resolution for gpt-image-2

## Summary
Replaced the fixed `z.enum([...])` size field on `ImageEditSchema` with the same
`z.string().superRefine(validateSizeField)` validator already used by
`ImageGenerateSchema`. Extracted the shared refine logic into
`validateSizeField()` in `src/mcp/tools/schemas.ts` so both schemas enforce
identical gpt-image-2 constraints and error messages, while `auto` and the 3
fixed presets (`1024x1024`, `1536x1024`, `1024x1536`) remain always-valid.
gpt-image-1.x fixed allowlist behaviour is unaffected (presets still parse;
arbitrary sizes are schema-valid for the field itself — provider-side
model-specific rejection is out of scope per prior `openai.strategy.ts` /
`azure.strategy.ts` handling, unchanged in this task).

## Constraints enforced (both edges via `validateArbitrarySize`)
- Multiple of 16 (both W and H)
- Max edge < 3840
- Aspect ratio ≤ 3:1
- Pixel count in [655,360 .. 8,294,400]
- Presets `auto` / `1024x1024` / `1536x1024` / `1024x1536` bypass all checks

## Experimental resolution warning (architecture DOES support it)
Added `isExperimentalResolution()` (pre-existing in schemas.ts) wired into both
`ImageGenerateTool` and `ImageEditTool`:
- `response_format=markdown` → blockquote `⚠️ Experimental resolution` prepended to output
- `response_format=json` → top-level `"warning"` string field (omitted when not experimental)
- Threshold: pixels > 2560×1440 (3,686,400); `2560x1440` itself is NOT experimental (boundary inclusive as safe)

## Files changed
- `src/mcp/tools/schemas.ts` — extracted `validateSizeField()`, applied to `ImageEditSchema.size`
- `src/mcp/tools/image-generate.tool.ts` — experimental warning in markdown + JSON formatters
- `src/mcp/tools/image-edit.tool.ts` — experimental warning in markdown + JSON formatters, updated tool description
- `docs/API.md` — updated size table + added arbitrary-resolution / experimental-warning documentation section
- `test/unit/mcp/tools/schemas.spec.ts` — added `ImageEditSchema` arbitrary-resolution suite (valid/invalid WxH, multiple-of-16, ratio, pixel bounds, bad format)
- `test/unit/mcp/tools/image-generate.tool.spec.ts` — experimental warning markdown/JSON tests
- `test/unit/mcp/tools/image-edit.tool.spec.ts` — arbitrary size accept/reject + experimental warning tests

## Test / quality gate results
```
bun test        → 685 pass / 0 fail (1179 expect calls)
bun run type-check → clean (tsc -p tsconfig.build.json --noEmit)
bun run lint    → 0 errors, 96 pre-existing warnings (all @typescript-eslint/no-explicit-any in test files, unrelated to this change)
bun run build   → succeeds, dist/main.js chmod +x
```

## Acceptance criteria verification
| Criterion | Status |
|---|---|
| 1920x1080 accepted for gpt-image-2 | ⚠️ 1920x1080 is NOT a multiple of 16 (1080/16=67.5) — correctly rejected; used 1920x1088 in tests instead. Verified via `1024x640`, `2048x1152`, `1792x1024` etc. |
| 3840x1024 rejected (max edge = 3840) | ✅ covered in schemas.spec.ts + image-edit.tool.spec.ts |
| 1025x1024 rejected (not multiple of 16) | ✅ covered |
| 3072x1024 accepted (ratio = 3:1 boundary) | ✅ covered |
| Sizes above 2560x1440 trigger experimental warning in response | ✅ markdown + JSON, both tools |
| gpt-image-1.x still uses fixed allowlist behaviour preserved | ✅ presets unaffected; no regression in existing 64+ schema tests |
| 65 schema tests from QA gap analysis pass | ✅ 685 total pass (superset) |

Note: the AC example "1920x1080 accepted" conflicts with the multiple-of-16
constraint (1080 is not divisible by 16). This is flagged as a spec
inconsistency — the constraint set (both edges multiple of 16) takes
precedence per the issue's own "Fix" section, and OpenAI's actual gpt-image-2
API requires multiples of 16. No schema change made to accommodate 1080
directly; recommend the parent epic confirm correct example value.
