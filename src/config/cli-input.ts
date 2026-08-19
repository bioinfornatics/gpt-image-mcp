/**
 * CliInput — the clean, typed contract between a future CLI argument parser
 * (gpt-image-mcp-593.9) and the configuration resolver (this file's
 * companion, config-resolver.ts).
 *
 * Scope note: THIS FILE DOES NOT PARSE argv. It only defines the shape of
 * already-parsed, validated CLI input so the resolver can merge it with
 * canonical env vars, legacy aliases, and secret sources using a single,
 * documented precedence order:
 *
 *     CLI > canonical IMAGE_* env > legacy aliases > secret backend > defaults
 *
 * Security note: CLI input NEVER carries raw secret values (no --api-key
 * flag). Secrets are only ever referenced by file path (`*File` fields
 * below), consistent with the project's "no secrets on the command line or
 * in process listings" posture. The resolver reads the referenced file
 * exactly once and never logs or echoes its contents.
 */

import type { AzureAuthMode, McpAuthMode, ProviderName } from './app.config';
import type { SecretBackend } from './secret-loader';

export interface CliInput {
  // ── Provider selection & non-secret provider settings ──────────────────
  provider?: ProviderName;
  baseUrl?: string;
  deployment?: string;
  apiVersion?: string;
  models?: string[];
  defaultModel?: string;
  azureAuthMode?: AzureAuthMode;
  azureTenantId?: string;

  // ── MCP transport / server ──────────────────────────────────────────────
  mcpTransport?: 'http' | 'stdio';
  port?: number;
  mcpAuthMode?: McpAuthMode;
  requireMcpAuth?: boolean;
  useElicitation?: boolean;
  useSampling?: boolean;

  // ── Security / misc ──────────────────────────────────────────────────────
  maxRequestsPerMinute?: number;
  logLevel?: string;
  secretBackend?: SecretBackend;

  // ── Entra (non-secret) ───────────────────────────────────────────────────
  entraTenantId?: string;
  entraClientId?: string;
  entraAudience?: string;
  entraScope?: string;
  entraAllowedClientIds?: string[];

  // ── Secret references (file paths only — never raw secret values) ──────
  apiKeyFile?: string;
  mcpApiKeyFile?: string;
  entraClientSecretFile?: string;
}

/** A CliInput with no fields set — the resolver's default when no parser is wired yet. */
export const EMPTY_CLI_INPUT: Readonly<CliInput> = Object.freeze({});
