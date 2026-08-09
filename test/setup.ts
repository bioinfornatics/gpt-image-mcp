/**
 * Global test setup — runs before all test files via bunfig.toml preload.
 * Sets environment variables required for NestJS config validation in tests.
 * Real credentials are never used — these are stub values for unit/integration tests.
 */

// Only set defaults — real env vars from CI/local .env override these
process.env['IMAGE_PROVIDER'] = process.env['IMAGE_PROVIDER'] ?? 'openai';
process.env['IMAGE_API_KEY'] = process.env['IMAGE_API_KEY'] ?? 'sk-test-fake-key-for-tests';
process.env['IMAGE_MCP_TRANSPORT'] = process.env['IMAGE_MCP_TRANSPORT'] ?? 'http';
process.env['IMAGE_PORT'] = process.env['IMAGE_PORT'] ?? '3001';
process.env['IMAGE_LOG_LEVEL'] = process.env['IMAGE_LOG_LEVEL'] ?? 'error';
// Keep test default pinned to gpt-image-1 so unit tests referencing that model string stay stable.
// Integration tests that care about the latest model should read LATEST_MODEL directly.
process.env['IMAGE_DEFAULT_MODEL'] = process.env['IMAGE_DEFAULT_MODEL'] ?? 'gpt-image-1';
process.env['IMAGE_MAX_REQUESTS_PER_MINUTE'] = process.env['IMAGE_MAX_REQUESTS_PER_MINUTE'] ?? '60';
process.env['IMAGE_USE_ELICITATION'] = process.env['IMAGE_USE_ELICITATION'] ?? 'true';
process.env['IMAGE_USE_SAMPLING'] = process.env['IMAGE_USE_SAMPLING'] ?? 'true';
// Disable mandatory MCP auth in tests — no IMAGE_MCP_API_KEY is set in the test environment.
// Production deployments should set IMAGE_REQUIRE_MCP_AUTH=true (the default) and provide IMAGE_MCP_API_KEY.
process.env['IMAGE_REQUIRE_MCP_AUTH'] = process.env['IMAGE_REQUIRE_MCP_AUTH'] ?? 'false';
