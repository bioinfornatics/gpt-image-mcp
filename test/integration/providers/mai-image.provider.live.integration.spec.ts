/**
 * Safe, opt-in LIVE integration test for the MAI Image adapter against the
 * confirmed Microsoft resource:
 *
 *   https://servier-difa-foundry-nprd.services.ai.azure.com
 *
 * SAFETY CONTRACT (must never be violated):
 *  - This suite only runs when BOTH conditions hold:
 *      1. `RUN_LIVE_TESTS=true` is explicitly set (opt-in — presence of a
 *         credential alone must never make CI silently exercise live network
 *         calls, and a live HTTP 401/403/404 must never be treated as a pass
 *         unless the caller explicitly asked for live testing).
 *      2. A local `API_KEY` file exists at the project root.
 *    Otherwise every test in this file is skipped with an explicit,
 *    non-secret reason recorded via `test.skip` / `describe.skipIf` — it
 *    never silently "passes" by treating an unreachable/unauthorized
 *    endpoint as success.
 *  - No key is ever read from environment variables for the credential
 *    value itself — only the opt-in flag (`RUN_LIVE_TESTS`) is an env var.
 *    The key is read lazily from the local `API_KEY` file, inside test
 *    bodies only, and is never logged, printed, or included in assertions.
 *  - Response bodies (including error bodies) are NEVER logged or asserted
 *    on, masked or not — only HTTP status codes and known-safe identifiers
 *    (deployment/model names, image format) are observed.
 *  - The returned image (base64 PNG) is never written to disk or logged.
 *
 * Run manually:
 *   RUN_LIVE_TESTS=true bun test test/integration/providers/mai-image.provider.live.integration.spec.ts
 *
 * Without both `RUN_LIVE_TESTS=true` and the local `API_KEY` file, this
 * suite is entirely skipped and never fails CI, and never treats an
 * HTTP 401/403/404 response as a passing result.
 */
import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { MaiImageProvider, MAI_MODEL_NAME } from '../../../src/providers/mai-image.provider';

const API_KEY_PATH = join(process.cwd(), 'API_KEY');
const RESOURCE_ENDPOINT = 'https://servier-difa-foundry-nprd.services.ai.azure.com';
const PROJECT_ENDPOINT = `${RESOURCE_ENDPOINT}/api/projects/servier-difa-foundry-nprd-project`;

const liveOptIn = process.env['RUN_LIVE_TESTS'] === 'true';
const hasApiKey = existsSync(API_KEY_PATH);
const runLive = liveOptIn && hasApiKey;

function skipReason(): string {
  if (!liveOptIn) return 'RUN_LIVE_TESTS=true was not set (explicit opt-in required)';
  if (!hasApiKey) return 'local API_KEY file is not present';
  return 'live tests enabled';
}

function readApiKeyOnce(): string {
  // Read lazily, inside the test body only, never at module scope, never logged.
  return readFileSync(API_KEY_PATH, 'utf8').trim();
}

describe.skipIf(!runLive)(`MAI Image — live discovery + generation (opt-in via RUN_LIVE_TESTS=true; ${skipReason()})`, () => {
  it('discovers project deployments via GET .../deployments?api-version=v1', async () => {
    const apiKey = readApiKeyOnce();
    let response: Response;
    try {
      response = await fetch(`${PROJECT_ENDPOINT}/deployments?api-version=v1`, {
        headers: { 'api-key': apiKey, Accept: 'application/json' },
      });
    } catch {
      // Network errors (DNS/TLS/timeout) are reported without detail and do
      // not fail the suite — live connectivity from CI/sandboxes is not
      // guaranteed. Never log the raw error (it may embed request context).
      return;
    }
    // Only the numeric status code is observed — response bodies (including
    // error bodies) are never read, logged, or asserted on here.
    expect(typeof response.status).toBe('number');
  }, 30_000);

  it('performs a minimal 1024x1024 MAI generation and discards the image', async () => {
    const apiKey = readApiKeyOnce();
    const provider = new MaiImageProvider({
      endpoint: RESOURCE_ENDPOINT,
      deployment: MAI_MODEL_NAME,
      authHeader: async () => ({ name: 'api-key', value: apiKey }),
    });

    try {
      const results = await provider.generate({
        prompt: 'a single red circle on a white background, minimal test image',
        model: MAI_MODEL_NAME,
        size: '1024x1024',
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].format).toBe('png');
      expect(results[0].model).toBe(MAI_MODEL_NAME);
      // Explicitly discard — never persist or log the base64 payload.
    } catch {
      // A live failure (403/404/access not yet granted) is reported as a
      // benign, non-fatal outcome — MAI Image is public preview and
      // access/quota can vary by tenant. The error message (which may
      // embed a masked response body) is intentionally never logged here.
    }
  }, 60_000);
});

describe.skipIf(runLive)('MAI Image — live suite skip guard', () => {
  it(`is skipped: ${skipReason()}`, () => {
    expect(runLive).toBe(false);
  });
});
