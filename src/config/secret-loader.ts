/**
 * Secret Loader — resolves secrets from multiple backends before startup validation.
 *
 * Priority order (first match wins):
 *   1. *_FILE env var  → read file contents (Docker secrets, K8s secrets, tmpfs)
 *   2. keytar          → OS keychain (macOS Keychain, GNOME Keyring, Windows Credential Manager)
 *   3. plain env var   → fallback (least secure, convenient for dev)
 *
 * The active backend is selected by SECRET_BACKEND env var:
 *   SECRET_BACKEND=file    (default) — _FILE vars only, plain vars as fallback
 *   SECRET_BACKEND=keytar  — keytar first, then _FILE, then plain
 *   SECRET_BACKEND=env     — plain env vars only (opt-out of _FILE resolution)
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
  'OPENAI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'MCP_API_KEY',
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
        `[gpt-image-mcp] WARNING: Secret file "${resolved}" is world-readable ` +
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
        `[gpt-image-mcp] WARNING: Both ${varName} and ${fileEnvVar} are set. ` +
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

const KEYTAR_SERVICE = 'gpt-image-mcp';

/**
 * Map from env var name → keytar account name.
 * Allows different keys per account on the same machine.
 */
const KEYTAR_ACCOUNT_MAP: Record<FileSourceableVar, string> = {
  OPENAI_API_KEY: 'openai-api-key',
  AZURE_OPENAI_API_KEY: 'azure-openai-api-key',
  MCP_API_KEY: 'mcp-api-key',
};

/**
 * Attempt to load secrets from the OS keychain via keytar.
 * keytar is an *optional* peer dependency — if not installed this is a no-op
 * (with a clear startup warning if SECRET_BACKEND=keytar was requested).
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
      `[gpt-image-mcp] WARNING: SECRET_BACKEND=keytar requested but keytar is not installed.\n` +
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
      const secret = await keytar.getPassword(KEYTAR_SERVICE, account);
      if (secret) {
        process.env[varName] = secret;
        process.stderr.write(
          `[gpt-image-mcp] Loaded ${varName} from OS keychain (account: ${account}).\n`,
        );
      }
    } catch (err) {
      process.stderr.write(
        `[gpt-image-mcp] WARNING: Could not read ${varName} from keychain: ${String(err)}\n`,
      );
    }
  }
}

// ─── CLI helper for keytar ────────────────────────────────────────────────────

/**
 * Store a secret in the OS keychain.
 * Usage: STORE_SECRET=OPENAI_API_KEY SECRET_VALUE=sk-... bun run src/cli/store-secret.ts
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

// ─── Main entrypoint ─────────────────────────────────────────────────────────

/**
 * Resolve all secrets according to the configured backend.
 * Call this ONCE, before NestJS bootstrap, so ConfigModule sees resolved values.
 */
export async function resolveSecrets(): Promise<void> {
  const backend: SecretBackend =
    (process.env['SECRET_BACKEND'] as SecretBackend | undefined) ?? 'file';

  if (backend === 'env') {
    // Explicit opt-out — plain env vars only, no file or keychain resolution
    return;
  }

  if (backend === 'keytar') {
    // keytar first, then _FILE as fallback
    await resolveKeytarSecrets();
    resolveFileSecrets(); // fills in anything keytar didn't provide
    return;
  }

  // Default: 'file' — resolve _FILE vars, plain env vars as fallback
  resolveFileSecrets();
}
