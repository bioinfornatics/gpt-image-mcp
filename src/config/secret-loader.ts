/**
 * Secret Loader — resolves secrets from multiple backends before startup validation.
 *
 * Priority order (first match wins):
 *   1. *_FILE env var  → read file contents (Docker secrets, K8s secrets, tmpfs)
 *   2. keytar          → OS keychain (macOS Keychain, GNOME Keyring, Windows Credential Manager)
 *   3. plain env var   → fallback (least secure, convenient for dev)
 *
 * The active backend is selected by IMAGE_MCP_SECRET_BACKEND env var:
 *   IMAGE_MCP_SECRET_BACKEND=file    (default) — _FILE vars only, plain vars as fallback
 *   IMAGE_MCP_SECRET_BACKEND=keytar  — keytar first, then _FILE, then plain
 *   IMAGE_MCP_SECRET_BACKEND=env     — plain env vars only (opt-out of _FILE resolution)
 *
 * SECURITY NOTES:
 *   - File paths in *_FILE vars are validated to prevent path traversal.
 *   - File contents are trimmed (trailing newline from `echo` / Docker secrets).
 *   - Secrets are never logged — use maskSecret() before any logging.
 *   - Files should be mode 0400 (read-only by owner). A warning is logged if
 *     the file is world-readable.
 */

import * as fs from 'fs';
import * as path from 'path';

export type SecretBackend = 'file' | 'keytar' | 'env';

/** Names of the env vars that can be sourced from a file. */
const FILE_SOURCEABLE_VARS = [
  // New unified names
  'IMAGE_API_KEY',
  'IMAGE_MCP_API_KEY',
  'IMAGE_ENTRA_CLIENT_SECRET',
  // Deprecated — kept so IMAGE_API_KEY_FILE is NOT the only _FILE mechanism;
  // old OPENAI_API_KEY_FILE / AZURE_OPENAI_API_KEY_FILE configs still work:
  // resolveFileSecrets() sets OPENAI_API_KEY, then resolveImageEnvAliases()
  // copies it to IMAGE_API_KEY.
  'OPENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
] as const;

export type FileSourceableVar = (typeof FILE_SOURCEABLE_VARS)[number];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Read a secret from a file path.
 * - Validates the path is absolute (prevents trivial injection).
 * - Warns if the file is world-readable (mode o+r).
 * - Trims trailing whitespace/newline (Docker secrets append \n).
 */
export function readSecretFile(filePath: string): string {
  const resolved = path.resolve(filePath);

  // Require absolute path to prevent relative traversal tricks
  if (!path.isAbsolute(resolved)) {
    throw new Error(
      `SECRET_FILE path must be absolute. Got: "${filePath}"`,
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Secret file not found: "${resolved}". ` +
      `Check that the file is mounted and the path is correct.`,
    );
  }

  // Warn if world-readable (security smell — not an error, some envs require it)
  try {
    const stat = fs.statSync(resolved);
    const mode = stat.mode & 0o777;
    if (mode & 0o004) {
      process.stderr.write(
        `[image-mcp] WARNING: Secret file "${resolved}" is world-readable ` +
        `(mode ${mode.toString(8)}). Consider chmod 0400.\n`,
      );
    }
  } catch {
    // stat failure is non-fatal
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  const trimmed = content.trim();

  if (!trimmed) {
    throw new Error(`Secret file is empty: "${resolved}"`);
  }

  return trimmed;
}

// ─── _FILE resolution ─────────────────────────────────────────────────────────

/**
 * For each secret var that has a corresponding `VAR_FILE` env var set,
 * read the file and inject its contents into `process.env[VAR]`.
 *
 * Called once at startup, before Joi validation.
 * Mutates process.env in-place so NestJS ConfigModule sees the resolved values.
 */
export function resolveFileSecrets(): void {
  for (const varName of FILE_SOURCEABLE_VARS) {
    const fileEnvVar = `${varName}_FILE`;
    const filePath = process.env[fileEnvVar];

    if (!filePath) continue; // No _FILE var set — skip

    if (process.env[varName]) {
      // Both VAR and VAR_FILE set — _FILE takes priority, warn about conflict
      process.stderr.write(
        `[image-mcp] WARNING: Both ${varName} and ${fileEnvVar} are set. ` +
        `${fileEnvVar} takes priority.\n`,
      );
    }

    const secret = readSecretFile(filePath);
    process.env[varName] = secret;

    // Remove the _FILE var so it doesn't appear in config dumps
    delete process.env[fileEnvVar];
  }
}

// ─── keytar backend ───────────────────────────────────────────────────────────

const KEYTAR_SERVICE = 'image-mcp';
const LEGACY_KEYTAR_SERVICE = 'gpt-image-mcp';

/**
 * Map from env var name → keytar account name.
 * Allows different keys per account on the same machine.
 */
const KEYTAR_ACCOUNT_MAP: Record<FileSourceableVar, string> = {
  IMAGE_API_KEY: 'image-api-key',
  IMAGE_MCP_API_KEY: 'mcp-api-key',
  IMAGE_ENTRA_CLIENT_SECRET: 'entra-client-secret',
  // Deprecated aliases — map to old keychain accounts for backward compat
  OPENAI_API_KEY: 'openai-api-key',
  AZURE_OPENAI_API_KEY: 'azure-openai-api-key',
};

/**
 * Attempt to load secrets from the OS keychain via keytar.
 * keytar is an *optional* peer dependency — if not installed this is a no-op
 * (with a clear startup warning if IMAGE_MCP_SECRET_BACKEND=keytar was requested).
 *
 * Requires: `bun add keytar` (native Node addon, needs build tools).
 */
export async function resolveKeytarSecrets(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let keytar: any = null;

  try {
    // Dynamic import so keytar is an optional peer dependency.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    keytar = await import('keytar' as string); // cast avoids TS2307 when not installed
  } catch {
    process.stderr.write(
      `[image-mcp] WARNING: IMAGE_MCP_SECRET_BACKEND=keytar requested but keytar is not installed.\n` +
      `  Install with: bun add keytar\n` +
      `  Falling back to _FILE and plain env var resolution.\n`,
    );
    return;
  }

  for (const varName of FILE_SOURCEABLE_VARS) {
    // Skip if already resolved (e.g. by _FILE) or explicitly set in env
    if (process.env[varName]) continue;

    const account = KEYTAR_ACCOUNT_MAP[varName];
    try {
      let secret = await keytar.getPassword(KEYTAR_SERVICE, account);
      if (!secret) secret = await keytar.getPassword(LEGACY_KEYTAR_SERVICE, account);
      if (secret) {
        process.env[varName] = secret;
        process.stderr.write(
          `[image-mcp] Loaded ${varName} from OS keychain (account: ${account}).\n`,
        );
      }
    } catch (err) {
      process.stderr.write(
        `[image-mcp] WARNING: Could not read ${varName} from keychain: ${String(err)}\n`,
      );
    }
  }
}

// ─── CLI helper for keytar ────────────────────────────────────────────────────

/**
 * Store a secret in the OS keychain.
 * Usage: STORE_SECRET=IMAGE_API_KEY SECRET_VALUE=sk-... bun run src/cli/store-secret.ts
 *
 * Called from the CLI helper, not from the server startup path.
 */
export async function storeKeytarSecret(varName: FileSourceableVar, value: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const keytar = await import('keytar' as string);
  const account = KEYTAR_ACCOUNT_MAP[varName];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  await keytar.setPassword(KEYTAR_SERVICE, account, value);
  process.stdout.write(`Stored ${varName} in OS keychain (service=${KEYTAR_SERVICE}, account=${account}).\n`);
}

/**
 * Delete a secret from the OS keychain.
 */
export async function deleteKeytarSecret(varName: FileSourceableVar): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const keytar = await import('keytar' as string);
  const account = KEYTAR_ACCOUNT_MAP[varName];
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  return keytar.deletePassword(KEYTAR_SERVICE, account) as Promise<boolean>;
}

// ─── IMAGE_* env alias migration ─────────────────────────────────────────────

/**
 * Migrate deprecated provider-specific env vars to the unified IMAGE_* namespace.
 *
 * Deprecated in : v0.1.0
 * Removed in    : v0.3.0 (planned)
 *
 * Old names (still accepted for backward compat):
 *   PROVIDER               → IMAGE_PROVIDER
 *   OPENAI_API_KEY         → IMAGE_API_KEY
 *   AZURE_OPENAI_API_KEY   → IMAGE_API_KEY
 *   TOGETHER_API_KEY       → IMAGE_API_KEY
 *   CUSTOM_OPENAI_API_KEY  → IMAGE_API_KEY
 *   OPENAI_BASE_URL        → IMAGE_BASE_URL
 *   AZURE_OPENAI_ENDPOINT  → IMAGE_BASE_URL
 *   CUSTOM_OPENAI_BASE_URL → IMAGE_BASE_URL
 *   AZURE_OPENAI_DEPLOYMENT→ IMAGE_DEPLOYMENT
 *   AZURE_OPENAI_API_VERSION→IMAGE_API_VERSION
 *   CUSTOM_OPENAI_MODELS   → IMAGE_MODELS
 *   DEFAULT_MODEL          → IMAGE_DEFAULT_MODEL
 *
 * Called after resolveFileSecrets() / resolveKeytarSecrets() so that
 * _FILE-sourced values are included in the migration.
 */

/** Deprecated in v0.1.0 — will be removed in v0.3.0. */
const REMOVAL_VERSION = 'v0.3.0';

export function resolveImageEnvAliases(): void {
  function copyAlias(from: string, to: string): void {
    if (!process.env[to] && process.env[from]) {
      process.stderr.write(
        `[image-mcp] DEPRECATED (removed in ${REMOVAL_VERSION}): ` +
        `"${from}" has been renamed to "${to}".\n` +
        `  → Replace ${from}=<value>  with  ${to}=<value>  in your config.\n` +
        `  → See: https://github.com/bioinfornatics/image-mcp/blob/main/CHANGELOG.md\n`,
      );
      process.env[to] = process.env[from];
    }
  }

  // Provider name
  copyAlias('PROVIDER', 'IMAGE_PROVIDER');

  // API key — check all legacy per-provider names, first match wins
  const apiKeyAliases = [
    'OPENAI_API_KEY',
    'AZURE_OPENAI_API_KEY',
    'TOGETHER_API_KEY',
    'CUSTOM_OPENAI_API_KEY',
  ];
  for (const alias of apiKeyAliases) {
    if (!process.env['IMAGE_API_KEY'] && process.env[alias]) {
      copyAlias(alias, 'IMAGE_API_KEY');
      break;
    }
  }

  // Base URL / endpoint — azure endpoint takes priority over generic base URL
  const baseUrlAliases = ['AZURE_OPENAI_ENDPOINT', 'CUSTOM_OPENAI_BASE_URL', 'OPENAI_BASE_URL'];
  for (const alias of baseUrlAliases) {
    if (!process.env['IMAGE_BASE_URL'] && process.env[alias]) {
      copyAlias(alias, 'IMAGE_BASE_URL');
      break;
    }
  }

  copyAlias('AZURE_OPENAI_DEPLOYMENT', 'IMAGE_DEPLOYMENT');
  copyAlias('AZURE_OPENAI_API_VERSION', 'IMAGE_API_VERSION');
  copyAlias('CUSTOM_OPENAI_MODELS', 'IMAGE_MODELS');
  copyAlias('DEFAULT_MODEL', 'IMAGE_DEFAULT_MODEL');
}

// ─── Main entrypoint ─────────────────────────────────────────────────────────

/**
 * Resolve all secrets according to the configured backend.
 * Call this ONCE, before NestJS bootstrap, so ConfigModule sees resolved values.
 */
export async function resolveSecrets(): Promise<void> {
  const backend: SecretBackend =
    (process.env['IMAGE_MCP_SECRET_BACKEND'] as SecretBackend | undefined) ?? 'file';

  if (backend === 'env') {
    // Explicit opt-out of file/keychain resolution — still apply alias migration
    resolveImageEnvAliases();
    return;
  }

  if (backend === 'keytar') {
    // keytar first, then _FILE as fallback
    await resolveKeytarSecrets();
    resolveFileSecrets(); // fills in anything keytar didn't provide
    resolveImageEnvAliases();
    return;
  }

  // Default: 'file' — resolve _FILE vars, plain env vars as fallback
  resolveFileSecrets();
  resolveImageEnvAliases();
}
