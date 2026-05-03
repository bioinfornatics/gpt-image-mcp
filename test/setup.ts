/**
 * Global test setup — runs before all test files via bunfig.toml preload.
 * Sets environment variables required for NestJS config validation in tests.
 * Real credentials are never used — these are stub values for unit/integration tests.
 */

// Only set defaults — real env vars from CI/local .env override these
process.env['PROVIDER'] = process.env['PROVIDER'] ?? 'openai';
process.env['OPENAI_API_KEY'] = process.env['OPENAI_API_KEY'] ?? 'sk-test-fake-key-for-tests';
process.env['MCP_TRANSPORT'] = process.env['MCP_TRANSPORT'] ?? 'http';
process.env['PORT'] = process.env['PORT'] ?? '3001';
process.env['LOG_LEVEL'] = process.env['LOG_LEVEL'] ?? 'error';
// Keep test default pinned to gpt-image-1 so unit tests referencing that model string stay stable.
// Integration tests that care about the latest model should read LATEST_MODEL directly.
process.env['DEFAULT_MODEL'] = process.env['DEFAULT_MODEL'] ?? 'gpt-image-1';
process.env['MAX_REQUESTS_PER_MINUTE'] = process.env['MAX_REQUESTS_PER_MINUTE'] ?? '60';
process.env['USE_ELICITATION'] = process.env['USE_ELICITATION'] ?? 'true';
process.env['USE_SAMPLING'] = process.env['USE_SAMPLING'] ?? 'true';
// Disable mandatory MCP auth in tests — no MCP_API_KEY is set in the test environment.
// Production deployments should set REQUIRE_MCP_AUTH=true (the default) and provide MCP_API_KEY.
process.env['REQUIRE_MCP_AUTH'] = process.env['REQUIRE_MCP_AUTH'] ?? 'false';
