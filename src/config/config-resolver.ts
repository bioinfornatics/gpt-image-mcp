/**
 * Config Resolver — pure, pre-NestJS configuration resolution pipeline.
 *
 * Merges (in strict precedence order, highest wins):
 *
 *   1. CLI override object   (typed, passed in by the caller — see gpt-image-mcp-593.9)
 *   2. Canonical IMAGE_* environment variables
 *   3. Legacy/deprecated aliases (PROVIDER, OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, ...)
 *   4. Built-in defaults
 *
 * This module is intentionally CLI-parsing-free: gpt-image-mcp-593.9 will add the
 * `--flag` → `CliConfigOverride` mapping. Callers construct the override object
 * however they like (argv parser, test fixture, programmatic embedding, etc.).
 *
 * Secrets (`apiKey`, `mcpApiKey`, `entraClientSecret`) are NOT re-resolved here.
 * `resolveSecrets()` (see ./secret-loader.ts) must run first and populate the
 * canonical `IMAGE_*` environment variables from `_FILE` / keytar backends —
 * this module only reads whatever ends up in `env` at call time and never
 * reads a `*_FILE` variable or touches keytar itself.
 *
 * SAFETY INVARIANTS (enforced by test/unit/config/config-resolver.spec.ts):
 *   - `provenance` entries NEVER contain the resolved value, secret or not —
 *     only metadata (source, canonical env name, legacy env name used).
 *   - `diagnostics` messages NEVER interpolate a resolved value — only
 *     environment variable *names* and config *keys*.
 */

import { LATEST_MODEL } from './models';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Provenance of a single resolved configuration value. */
export type ConfigSource = 'cli' | 'env' | 'legacy' | 'default';

/** Static description of one configuration field and how it may be supplied. */
export interface ConfigFieldSpec {
  /** Normalized/internal key — matches the CliConfigOverride property name. */
  readonly key: string;
  /** Canonical `IMAGE_*` environment variable name. */
  readonly canonicalEnv: string;
  /** Deprecated aliases accepted for backward compatibility, checked in order. */
  readonly legacyEnvs: readonly string[];
  /** Property name on CliConfigOverride that supplies this field, if any. */
  readonly cliKey?: keyof CliConfigOverride;
  /** Applied when no CLI/env/legacy value is present. */
  readonly defaultValue?: string;
  /** Marks the field as a secret — never logged, never present in provenance/diagnostics. */
  readonly secret?: boolean;
}

/** Metadata about how one field's value was derived. Never carries the value itself. */
export interface ConfigProvenanceEntry {
  readonly source: ConfigSource;
  readonly canonicalEnv: string;
  readonly legacyEnvUsed?: string;
  readonly secret: boolean;
}

/** Result of resolving the full field registry against a CLI override + environment. */
export interface ConfigResolution {
  /** Resolved string values keyed by field key. `undefined` when unset and no default exists. */
  readonly values: Readonly<Record<string, string | undefined>>;
  /** Per-field provenance metadata — never contains resolved values. */
  readonly provenance: Readonly<Record<string, ConfigProvenanceEntry>>;
  /** Human-readable, value-free diagnostics about precedence/conflicts encountered. */
  readonly diagnostics: readonly string[];
}

/**
 * Typed CLI override object accepted by resolveConfig().
 *
 * gpt-image-mcp-593.9 owns turning argv into this shape (flag parsing, --help,
 * --version). This task only defines the contract and precedence semantics.
 * All values are strings (or undefined) to mirror raw environment variable
 * semantics — callers/CLI parser are responsible for any richer typing.
 */
export interface CliConfigOverride {
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  deployment?: string;
  apiVersion?: string;
  models?: string;
  defaultModel?: string;
  azureAuthMode?: string;
  azureTenantId?: string;
  entraTenantId?: string;
  entraClientId?: string;
  entraAudience?: string;
  entraScope?: string;
  entraAllowedClientIds?: string;
  entraClientSecret?: string;
  transport?: string;
  port?: string;
  mcpApiKey?: string;
  mcpAuthMode?: string;
  requireMcpAuth?: string;
  useElicitation?: string;
  useSampling?: string;
  maxRequestsPerMinute?: string;
  logLevel?: string;
  secretBackend?: string;
}

// ─── Registry ────────────────────────────────────────────────────────────────

/**
 * Single internal source of truth for every configuration field this resolver
 * understands. Mirrors the canonical/legacy pairs already defined by
 * `resolveImageEnvAliases()` in ./secret-loader.ts and the shape of AppConfig
 * in ./app.config.ts — kept in sync deliberately, not derived, to avoid a
 * broad refactor of either module.
 *
 * NOTE: IMAGE_DEPLOYMENT is intentionally the single Azure deployment field —
 * there is no per-provider deployment variant beyond its legacy alias.
 */
export const CONFIG_FIELD_REGISTRY: readonly ConfigFieldSpec[] = [
  { key: 'provider', canonicalEnv: 'IMAGE_PROVIDER', legacyEnvs: ['PROVIDER'], cliKey: 'provider' },
  {
    key: 'apiKey',
    canonicalEnv: 'IMAGE_API_KEY',
    legacyEnvs: ['OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'TOGETHER_API_KEY', 'CUSTOM_OPENAI_API_KEY'],
    cliKey: 'apiKey',
    secret: true,
  },
  {
    key: 'baseUrl',
    canonicalEnv: 'IMAGE_BASE_URL',
    legacyEnvs: ['AZURE_OPENAI_ENDPOINT', 'CUSTOM_OPENAI_BASE_URL', 'OPENAI_BASE_URL'],
    cliKey: 'baseUrl',
  },
  { key: 'deployment', canonicalEnv: 'IMAGE_DEPLOYMENT', legacyEnvs: ['AZURE_OPENAI_DEPLOYMENT'], cliKey: 'deployment' },
  {
    key: 'apiVersion',
    canonicalEnv: 'IMAGE_API_VERSION',
    legacyEnvs: ['AZURE_OPENAI_API_VERSION'],
    cliKey: 'apiVersion',
    defaultValue: '2025-04-01-preview',
  },
  { key: 'models', canonicalEnv: 'IMAGE_MODELS', legacyEnvs: ['CUSTOM_OPENAI_MODELS'], cliKey: 'models', defaultValue: 'custom' },
  {
    key: 'defaultModel',
    canonicalEnv: 'IMAGE_DEFAULT_MODEL',
    legacyEnvs: ['DEFAULT_MODEL'],
    cliKey: 'defaultModel',
    defaultValue: LATEST_MODEL,
  },
  { key: 'azureAuthMode', canonicalEnv: 'IMAGE_AZURE_AUTH_MODE', legacyEnvs: [], cliKey: 'azureAuthMode' },
  { key: 'azureTenantId', canonicalEnv: 'IMAGE_AZURE_TENANT_ID', legacyEnvs: [], cliKey: 'azureTenantId' },
  { key: 'entraTenantId', canonicalEnv: 'IMAGE_ENTRA_TENANT_ID', legacyEnvs: [], cliKey: 'entraTenantId' },
  { key: 'entraClientId', canonicalEnv: 'IMAGE_ENTRA_CLIENT_ID', legacyEnvs: [], cliKey: 'entraClientId' },
  { key: 'entraAudience', canonicalEnv: 'IMAGE_ENTRA_AUDIENCE', legacyEnvs: [], cliKey: 'entraAudience' },
  { key: 'entraScope', canonicalEnv: 'IMAGE_ENTRA_SCOPE', legacyEnvs: [], cliKey: 'entraScope', defaultValue: 'mcp.access' },
  {
    key: 'entraAllowedClientIds',
    canonicalEnv: 'IMAGE_ENTRA_ALLOWED_CLIENT_IDS',
    legacyEnvs: [],
    cliKey: 'entraAllowedClientIds',
    defaultValue: '',
  },
  { key: 'entraClientSecret', canonicalEnv: 'IMAGE_ENTRA_CLIENT_SECRET', legacyEnvs: [], cliKey: 'entraClientSecret', secret: true },
  { key: 'transport', canonicalEnv: 'IMAGE_MCP_TRANSPORT', legacyEnvs: [], cliKey: 'transport', defaultValue: 'http' },
  { key: 'port', canonicalEnv: 'IMAGE_PORT', legacyEnvs: [], cliKey: 'port', defaultValue: '3000' },
  { key: 'mcpApiKey', canonicalEnv: 'IMAGE_MCP_API_KEY', legacyEnvs: [], cliKey: 'mcpApiKey', secret: true },
  { key: 'mcpAuthMode', canonicalEnv: 'IMAGE_MCP_AUTH_MODE', legacyEnvs: [], cliKey: 'mcpAuthMode' },
  { key: 'requireMcpAuth', canonicalEnv: 'IMAGE_REQUIRE_MCP_AUTH', legacyEnvs: [], cliKey: 'requireMcpAuth', defaultValue: 'true' },
  { key: 'useElicitation', canonicalEnv: 'IMAGE_USE_ELICITATION', legacyEnvs: [], cliKey: 'useElicitation', defaultValue: 'true' },
  { key: 'useSampling', canonicalEnv: 'IMAGE_USE_SAMPLING', legacyEnvs: [], cliKey: 'useSampling', defaultValue: 'true' },
  {
    key: 'maxRequestsPerMinute',
    canonicalEnv: 'IMAGE_MAX_REQUESTS_PER_MINUTE',
    legacyEnvs: [],
    cliKey: 'maxRequestsPerMinute',
    defaultValue: '60',
  },
  { key: 'logLevel', canonicalEnv: 'IMAGE_LOG_LEVEL', legacyEnvs: [], cliKey: 'logLevel', defaultValue: 'info' },
  {
    key: 'secretBackend',
    canonicalEnv: 'IMAGE_MCP_SECRET_BACKEND',
    legacyEnvs: [],
    cliKey: 'secretBackend',
    defaultValue: 'file',
  },
] as const;

// ─── Resolution ──────────────────────────────────────────────────────────────

/**
 * Resolve a single field's value + provenance + any diagnostics it produces.
 * Pure function — never reads process.env directly, never logs.
 */
function resolveField(
  field: ConfigFieldSpec,
  cli: CliConfigOverride,
  env: Readonly<Record<string, string | undefined>>,
): { value: string | undefined; provenance: ConfigProvenanceEntry; diagnostics: string[] } {
  const diagnostics: string[] = [];

  const cliValue = field.cliKey ? cli[field.cliKey] : undefined;
  const canonicalValue = env[field.canonicalEnv];
  const legacyMatches = field.legacyEnvs.filter((name) => env[name] !== undefined);
  const legacyDistinctValues = new Set(legacyMatches.map((name) => env[name]));

  if (legacyMatches.length > 1 && legacyDistinctValues.size > 1) {
    diagnostics.push(
      `Conflicting legacy environment variables for "${field.key}": ` +
        `${legacyMatches.join(', ')} are set to different values. ` +
        `Set only "${field.canonicalEnv}" to avoid ambiguity.`,
    );
  }

  if (cliValue !== undefined && canonicalValue !== undefined) {
    diagnostics.push(
      `CLI override for "${field.key}" takes precedence over environment variable "${field.canonicalEnv}".`,
    );
  } else if (canonicalValue !== undefined && legacyMatches.length > 0) {
    diagnostics.push(
      `Canonical "${field.canonicalEnv}" takes precedence over legacy variable(s) ` +
        `${legacyMatches.join(', ')} for "${field.key}".`,
    );
  } else if (cliValue !== undefined && canonicalValue === undefined && legacyMatches.length > 0) {
    diagnostics.push(
      `CLI override for "${field.key}" takes precedence over legacy variable(s) ${legacyMatches.join(', ')}.`,
    );
  }

  let value: string | undefined;
  let source: ConfigSource;
  let legacyEnvUsed: string | undefined;

  if (cliValue !== undefined) {
    value = cliValue;
    source = 'cli';
  } else if (canonicalValue !== undefined) {
    value = canonicalValue;
    source = 'env';
  } else if (legacyMatches.length > 0) {
    legacyEnvUsed = legacyMatches[0];
    value = env[legacyEnvUsed];
    source = 'legacy';
  } else {
    value = field.defaultValue;
    source = 'default';
  }

  return {
    value,
    provenance: { source, canonicalEnv: field.canonicalEnv, legacyEnvUsed, secret: Boolean(field.secret) },
    diagnostics,
  };
}

/**
 * Resolve the full configuration field registry.
 *
 * Precedence per field: CLI override > canonical `IMAGE_*` env > legacy alias > default.
 *
 * `env` defaults to `process.env` but accepting it as a parameter keeps this
 * function pure/pluggable for tests. Secrets already resolved into canonical
 * `IMAGE_*` vars by `resolveSecrets()` (secret-loader.ts) flow through the
 * `env` precedence tier like any other canonical variable — this function
 * does not read `*_FILE` vars or invoke keytar itself.
 */
export function resolveConfig(
  cli: CliConfigOverride = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConfigResolution {
  const values: Record<string, string | undefined> = {};
  const provenance: Record<string, ConfigProvenanceEntry> = {};
  const diagnostics: string[] = [];

  for (const field of CONFIG_FIELD_REGISTRY) {
    const resolved = resolveField(field, cli, env);
    values[field.key] = resolved.value;
    provenance[field.key] = resolved.provenance;
    diagnostics.push(...resolved.diagnostics);
  }

  return { values, provenance, diagnostics };
}

/** Convenience lookup: field spec by key, for callers building a CLI parser (593.9). */
export function getConfigFieldSpec(key: string): ConfigFieldSpec | undefined {
  return CONFIG_FIELD_REGISTRY.find((field) => field.key === key);
}
