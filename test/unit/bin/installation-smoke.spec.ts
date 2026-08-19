/**
 * Installation smoke tests — gpt-image-mcp-593.10.
 *
 * Exercises the real CLI entrypoints (`bun run src/main.ts` and
 * `bin/start.sh`) as separate child processes to prove the packaged
 * launch contract works end-to-end, without ever touching NestJS/network:
 *
 *   - `--help` / `--version` exit 0 instantly with no provider configured
 *     (must not require IMAGE_PROVIDER/IMAGE_API_KEY at all).
 *   - `bin/start.sh` passes its arguments straight through to `main.ts`
 *     (argument passthrough) and still defaults IMAGE_MCP_TRANSPORT=stdio.
 *   - Unknown/rejected flags exit non-zero and print the contract help text;
 *     the success path (stdout / --check-config output) never contains a
 *     resolved secret value — only the literal string "***".
 *   - No test spawns a process expecting a raw secret to ever be *accepted*
 *     or written to a config-resolution result — only `-file` flags or env
 *     vars referencing a file path are used for real secret plumbing,
 *     consistent with the project's "no secrets in argv" posture. The
 *     rejected-flag tests intentionally pass an obviously-fake token to
 *     prove the flag itself is refused, not to assert argv is unreadable via
 *     `ps` (which no CLI design can prevent — hence `-file` flags exist).
 */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'child_process';
import { resolve } from 'path';
import pkg from '../../../package.json';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const MAIN = resolve(PROJECT_ROOT, 'src/main.ts');
const START_SH = resolve(PROJECT_ROOT, 'bin/start.sh');

/** Minimal env: no IMAGE_* vars at all, so --help/--version must not need any config. */
const BARE_ENV = { PATH: process.env['PATH'] ?? '' };

function runMain(args: string[], env: Record<string, string | undefined> = BARE_ENV) {
  return spawnSync('bun', ['run', MAIN, ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env,
    timeout: 15_000,
  });
}

function runStartSh(args: string[], env: Record<string, string | undefined> = BARE_ENV) {
  return spawnSync('bash', [START_SH, ...args], {
    cwd: '/tmp',
    encoding: 'utf8',
    env,
    timeout: 15_000,
  });
}

describe('installation smoke: src/main.ts', () => {
  it('--help exits 0 with no provider/secret configuration at all', () => {
    const result = runMain(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('image-mcp');
    expect(result.stdout).toContain('Usage:');
  });

  it('--version exits 0 with no provider/secret configuration at all', () => {
    const result = runMain(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^image-mcp \d+\.\d+\.\d+/);
  });

  it('rejects a raw --api-key argument (non-zero exit, flag itself never echoed as accepted)', () => {
    // NOTE: the parser flags "--api-key" as rejected AND separately reports its
    // dangling value token as an "Unknown option" (it is never consumed as a
    // value, by design, since --api-key never reaches VALUE_FLAGS handling).
    // That means the raw value token can appear verbatim in the *parse error*
    // text (not a secret leak via argv/process listing — argv itself, and any
    // `ps` snapshot of it, is the actual leak vector the design guards
    // against). This assertion pins the actually-guaranteed contract: the
    // flag is rejected, the process exits non-zero, and stdout (the success
    // path) never contains anything from this invocation.
    const result = runMain(['--api-key', 'sk-should-never-appear']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--api-key-file');
    expect(result.stderr).toContain('Option "--api-key" is not allowed');
    expect(result.stdout).toBe('');
  });

  it('--check-config resolves configuration from a secret FILE reference, never a raw value', () => {
    // Uses a file path, never a literal secret on argv/env — consistent with
    // the project's "no secrets on the command line" posture.
    const fixtureKeyFile = resolve(PROJECT_ROOT, 'test/fixtures/bin/dummy-api-key.txt');
    const result = runMain(['--provider', 'openai', '--api-key-file', fixtureKeyFile, '--check-config'], {
      ...BARE_ENV,
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { values: Record<string, string> };
    expect(parsed.values['provider']).toBe('openai');
    // Secret values are always redacted in --check-config output.
    expect(parsed.values['apiKey']).toBe('***');
    expect(result.stdout).not.toContain('dummy-secret-value');
  });

  it('unknown option exits non-zero and prints the stable help contract to stderr', () => {
    const result = runMain(['--totally-not-a-real-flag']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown option "--totally-not-a-real-flag"');
    expect(result.stderr).toContain('Usage:');
  });
});

describe('installation smoke: bin/start.sh (Goose launcher, argument passthrough)', () => {
  it('passes --help through to main.ts and exits 0 regardless of caller cwd', () => {
    const result = runStartSh(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it('passes --version through to main.ts and exits 0', () => {
    const result = runStartSh(['--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^image-mcp \d+\.\d+\.\d+/);
  });

  it('defaults IMAGE_MCP_TRANSPORT to stdio when the caller (e.g. Goose) omits it', () => {
    // --check-config surfaces the resolved transport without starting the server.
    const result = runStartSh(['--check-config'], { ...BARE_ENV, IMAGE_PROVIDER: 'openai', IMAGE_API_KEY: 'sk-test' });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { values: Record<string, string> };
    expect(parsed.values['transport']).toBe('stdio');
  });

  it('an explicit IMAGE_MCP_TRANSPORT is never overridden by the stdio default', () => {
    const result = runStartSh(['--check-config'], {
      ...BARE_ENV,
      IMAGE_PROVIDER: 'openai',
      IMAGE_API_KEY: 'sk-test',
      IMAGE_MCP_TRANSPORT: 'http',
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as { values: Record<string, string> };
    expect(parsed.values['transport']).toBe('http');
  });

  it('rejects a raw --mcp-api-key argument the same way main.ts does (passthrough of validation, not just args)', () => {
    const result = runStartSh(['--mcp-api-key', 'should-never-appear-either']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--mcp-api-key-file');
    expect(result.stderr).toContain('Option "--mcp-api-key" is not allowed');
    expect(result.stdout).toBe('');
  });
});


describe('package rename compatibility', () => {
  it('package exposes image-mcp as primary binary and gpt-image-mcp as temporary alias', () => {
    expect(pkg.name).toBe('@bioinfornatics/image-mcp');
    expect(pkg.bin).toEqual({
      'image-mcp': './dist/main.js',
      'gpt-image-mcp': './dist/main.js',
    });
  });
});
