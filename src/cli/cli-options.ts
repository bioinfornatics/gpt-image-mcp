/**
 * CLI argument parser — PURE, side-effect-free (gpt-image-mcp-593.9).
 *
 * MUST NOT import NestJS, secret-loader, keytar, or anything that touches
 * the filesystem/network/env beyond what the caller explicitly does with the
 * returned result. `parseCliArgs()` only inspects the `argv` array passed in
 * and returns a plain data structure — `--help` / `--version` must remain
 * instant, with zero NestJS/secret/keytar initialization, no matter what
 * other flags are also present.
 *
 * Secrets are never accepted as raw CLI values: `--api-key` and
 * `--mcp-api-key` are explicitly rejected (use the `-file` variants, which
 * only carry a filesystem *path*, never the secret itself).
 */

import type { CliConfigOverride } from '../config/config-resolver';

/** Flags that take no value. */
const BOOLEAN_FLAGS = new Set([
  '-h',
  '--help',
  '-V',
  '--version',
  '--check-config',
  '--show-config-sources',
  '--no-elicitation',
  '--no-sampling',
]);

/** Flags that require exactly one value argument following them. */
const VALUE_FLAGS = new Set([
  '--provider',
  '--deployment',
  '--transport',
  '--port',
  '--log-level',
  '--api-key-file',
  '--mcp-api-key-file',
]);

/** Flags rejected outright because they would carry a raw secret value on argv/ps. */
const REJECTED_SECRET_FLAGS = new Set(['--api-key', '--mcp-api-key']);

/** Result of parsing argv. Pure data — no side effects have occurred yet. */
export interface CliParseResult {
  /** True if parsing succeeded with no errors (unknown/rejected options, missing values). */
  readonly valid: boolean;
  /** Human-readable parse errors. Non-empty implies `valid === false`. */
  readonly errors: readonly string[];
  /** `-h` / `--help` requested. */
  readonly help: boolean;
  /** `-V` / `--version` requested. */
  readonly version: boolean;
  /** `--check-config` requested. */
  readonly checkConfig: boolean;
  /** `--show-config-sources` requested. */
  readonly showConfigSources: boolean;
  /** Typed overrides suitable for `resolveConfig(overrides, env)`. */
  readonly overrides: CliConfigOverride;
  /** Path from `--api-key-file`, if provided (sets `IMAGE_API_KEY_FILE`, never the secret itself). */
  readonly apiKeyFile?: string;
  /** Path from `--mcp-api-key-file`, if provided (sets `IMAGE_MCP_API_KEY_FILE`). */
  readonly mcpApiKeyFile?: string;
}

/**
 * Parse `process.argv.slice(2)`-style argv into a typed, pure result.
 * Never throws — all failure modes are reported via `errors`/`valid: false`.
 */
export function parseCliArgs(argv: readonly string[]): CliParseResult {
  const errors: string[] = [];
  let help = false;
  let version = false;
  let checkConfig = false;
  let showConfigSources = false;
  const overrides: CliConfigOverride = {};
  let apiKeyFile: string | undefined;
  let mcpApiKeyFile: string | undefined;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i] as string;

    if (REJECTED_SECRET_FLAGS.has(arg)) {
      errors.push(
        `Option "${arg}" is not allowed: raw secrets must never be passed as CLI arguments ` +
          `(they leak via process listings and shell history). Use ` +
          `"${arg}-file <path>" or the IMAGE_API_KEY_FILE / IMAGE_MCP_API_KEY_FILE env var instead.`,
      );
      i += 1;
      continue;
    }

    if (BOOLEAN_FLAGS.has(arg)) {
      switch (arg) {
        case '-h':
        case '--help':
          help = true;
          break;
        case '-V':
        case '--version':
          version = true;
          break;
        case '--check-config':
          checkConfig = true;
          break;
        case '--show-config-sources':
          showConfigSources = true;
          break;
        case '--no-elicitation':
          overrides.useElicitation = 'false';
          break;
        case '--no-sampling':
          overrides.useSampling = 'false';
          break;
      }
      i += 1;
      continue;
    }

    if (VALUE_FLAGS.has(arg)) {
      const value = argv[i + 1];
      if (value === undefined || (value.startsWith('-') && value !== '-')) {
        errors.push(`Option "${arg}" requires a value.`);
        i += 1;
        continue;
      }
      switch (arg) {
        case '--provider':
          overrides.provider = value;
          break;
        case '--deployment':
          overrides.deployment = value;
          break;
        case '--transport':
          overrides.transport = value;
          break;
        case '--port':
          overrides.port = value;
          break;
        case '--log-level':
          overrides.logLevel = value;
          break;
        case '--api-key-file':
          apiKeyFile = value;
          break;
        case '--mcp-api-key-file':
          mcpApiKeyFile = value;
          break;
      }
      i += 2;
      continue;
    }

    errors.push(`Unknown option "${arg}".`);
    i += 1;
  }

  return {
    valid: errors.length === 0,
    errors,
    help,
    version,
    checkConfig,
    showConfigSources,
    overrides,
    apiKeyFile,
    mcpApiKeyFile,
  };
}
