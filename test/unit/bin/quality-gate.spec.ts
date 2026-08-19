import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';

const PROJECT_ROOT = resolve(import.meta.dir, '..', '..', '..');
const SCRIPT = resolve(PROJECT_ROOT, 'bin', 'quality-gate.sh');

describe('bin/quality-gate.sh', () => {
  it('resolves the project root from its own location and enables strict mode', () => {
    const script = readFileSync(SCRIPT, 'utf8');

    expect(script).toContain('set -euo pipefail');
    expect(script).toContain('SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"');
    expect(script).toContain('PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"');
    expect(script).toContain('cd "$PROJECT_ROOT"');
  });

  it('never swallows a failing child command (no `|| true` / unchecked ignore)', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    const executableLines = script
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');

    expect(executableLines).not.toMatch(/\|\|\s*true\b/);
    expect(executableLines).not.toMatch(/;\s*true\s*$/m);
  });

  it('rejects an unknown gate name with a non-zero exit code, regardless of cwd', () => {
    const result = spawnSync('bash', [SCRIPT, 'not-a-real-gate'], {
      cwd: '/tmp',
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unknown gate');
  });

  it('propagates a failing gate exit code truthfully when BUN_BIN is a failing stub', () => {
    // Simulate "bun run lint" failing (e.g. a real lint error) by pointing
    // BUN_BIN at a stub that always exits non-zero, and assert the wrapper
    // does not mask that failure with its own success status.
    const result = spawnSync('bash', [SCRIPT, 'lint'], {
      cwd: '/tmp',
      encoding: 'utf8',
      env: {
        ...process.env,
        BUN_BIN: resolve(PROJECT_ROOT, 'test/fixtures/bin/failing-bun.sh'),
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.status).toBe(17);
  });

  it('runs successfully end-to-end from an unrelated cwd when the gate stub succeeds', () => {
    const result = spawnSync('bash', [SCRIPT, 'lint'], {
      cwd: '/tmp',
      encoding: 'utf8',
      env: {
        ...process.env,
        BUN_BIN: resolve(PROJECT_ROOT, 'test/fixtures/bin/succeeding-bun.sh'),
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('all requested gates passed: lint');
  });

  it('fails fast (127) when BUN_BIN cannot be found', () => {
    const result = spawnSync('bash', [SCRIPT, 'lint'], {
      cwd: '/tmp',
      encoding: 'utf8',
      env: { ...process.env, BUN_BIN: '/nonexistent/bun-binary-xyz' },
    });

    expect(result.status).toBe(127);
  });
});
