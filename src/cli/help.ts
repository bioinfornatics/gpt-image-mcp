/**
 * CLI Help & Version text — PURE module.
 *
 * MUST NOT import NestJS, secret-loader, keytar, or anything with side
 * effects. `printHelp()` / `getVersion()` are called before any secret
 * resolution or Nest bootstrap so `--help` / `--version` stay instant and
 * side-effect free (gpt-image-mcp-593.9).
 *
 * Reading package.json for the version string is a synchronous, local,
 * side-effect-free file read — no network, no keytar, no NestJS.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export const CLI_BIN_NAME = 'gpt-image-mcp';

export const HELP_TEXT = `${CLI_BIN_NAME} — MCP server for gpt-image-1 / gpt-image-2 image generation

Usage:
  ${CLI_BIN_NAME} [options]
  ${CLI_BIN_NAME} auth doctor

Options:
  -h, --help                    Show this help message and exit
  -V, --version                 Show version number and exit
  --check-config                Resolve configuration (CLI > env > legacy > default),
                                 print a redacted summary, and exit
  --show-config-sources         Like --check-config, but also print provenance
                                 (which source supplied each value) and exit

  --provider <name>             Image provider: openai | azure | together | custom
  --base-url <url>               Provider inference endpoint (IMAGE_BASE_URL)
  --foundry-project-endpoint <url>
                                 Azure Foundry project endpoint used for deployment discovery
                                 (IMAGE_FOUNDRY_PROJECT_ENDPOINT)
  --deployment <name>           Azure default deployment (IMAGE_DEPLOYMENT)
  --transport <mode>            Transport: http | stdio (IMAGE_MCP_TRANSPORT)
  --port <number>                HTTP listen port (IMAGE_PORT)
  --log-level <level>           debug | info | warn | error (IMAGE_LOG_LEVEL)
  --api-key-file <path>         Read the provider API key from a file
                                 (sets IMAGE_API_KEY_FILE)
  --mcp-api-key-file <path>     Read the MCP bearer token from a file
                                 (sets IMAGE_MCP_API_KEY_FILE)
  --no-elicitation              Disable MCP Elicitation (IMAGE_USE_ELICITATION=false)
  --no-sampling                 Disable MCP Sampling (IMAGE_USE_SAMPLING=false)

Rejected options (secrets must never be passed as raw CLI arguments):
  --api-key <value>             Use --api-key-file or IMAGE_API_KEY_FILE instead
  --mcp-api-key <value>         Use --mcp-api-key-file or IMAGE_MCP_API_KEY_FILE instead

Examples:
  ${CLI_BIN_NAME} --provider openai --base-url https://api.openai.com/v1 --api-key-file /run/secrets/api_key
  ${CLI_BIN_NAME} --provider azure --base-url https://example.services.ai.azure.com \
    --foundry-project-endpoint https://example.services.ai.azure.com/api/projects/my-project \
    --deployment MAI-Image-2.5 --transport stdio
  ${CLI_BIN_NAME} --check-config
  ${CLI_BIN_NAME} --show-config-sources
`;

/**
 * Reads the version string from package.json. Never throws to the caller in
 * normal operation; falls back to "0.0.0-unknown" if the file cannot be read
 * (e.g. unusual packaging layouts) so --version never crashes.
 */
export function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

export function printHelp(write: (line: string) => void = (line) => console.log(line)): void {
  write(HELP_TEXT);
}

export function printVersion(write: (line: string) => void = (line) => console.log(line)): void {
  write(`${CLI_BIN_NAME} ${getVersion()}`);
}
