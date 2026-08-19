import { describe, expect, it } from 'bun:test';
import { parseCliArgs } from '../../../src/cli/cli-options';

describe('parseCliArgs', () => {
  it('parses no args as valid with all flags false', () => {
    const result = parseCliArgs([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.help).toBe(false);
    expect(result.version).toBe(false);
    expect(result.checkConfig).toBe(false);
    expect(result.showConfigSources).toBe(false);
    expect(result.overrides).toEqual({});
  });

  it.each([
    ['-h'],
    ['--help'],
  ])('recognizes %s as help', (flag) => {
    const result = parseCliArgs([flag]);
    expect(result.valid).toBe(true);
    expect(result.help).toBe(true);
  });

  it.each([
    ['-V'],
    ['--version'],
  ])('recognizes %s as version', (flag) => {
    const result = parseCliArgs([flag]);
    expect(result.valid).toBe(true);
    expect(result.version).toBe(true);
  });

  it('recognizes --check-config', () => {
    const result = parseCliArgs(['--check-config']);
    expect(result.valid).toBe(true);
    expect(result.checkConfig).toBe(true);
  });

  it('recognizes --show-config-sources', () => {
    const result = parseCliArgs(['--show-config-sources']);
    expect(result.valid).toBe(true);
    expect(result.showConfigSources).toBe(true);
  });

  it('parses --provider value into overrides.provider', () => {
    const result = parseCliArgs(['--provider', 'azure']);
    expect(result.valid).toBe(true);
    expect(result.overrides.provider).toBe('azure');
  });

  it('parses --base-url into overrides.baseUrl', () => {
    const result = parseCliArgs(['--base-url', 'https://example.services.ai.azure.com']);
    expect(result.valid).toBe(true);
    expect(result.overrides.baseUrl).toBe('https://example.services.ai.azure.com');
  });

  it('parses --foundry-project-endpoint into overrides.foundryProjectEndpoint', () => {
    const result = parseCliArgs([
      '--foundry-project-endpoint',
      'https://example.services.ai.azure.com/api/projects/project-a',
    ]);
    expect(result.valid).toBe(true);
    expect(result.overrides.foundryProjectEndpoint)
      .toBe('https://example.services.ai.azure.com/api/projects/project-a');
  });

  it('parses --model into overrides.defaultModel', () => {
    const result = parseCliArgs(['--model', 'google/gemini-3.1-flash-image']);
    expect(result.valid).toBe(true);
    expect(result.overrides.defaultModel).toBe('google/gemini-3.1-flash-image');
  });

  it('parses --deployment value into overrides.deployment', () => {
    const result = parseCliArgs(['--deployment', 'gpt-image-2']);
    expect(result.valid).toBe(true);
    expect(result.overrides.deployment).toBe('gpt-image-2');
  });

  it('parses --transport value into overrides.transport', () => {
    const result = parseCliArgs(['--transport', 'stdio']);
    expect(result.valid).toBe(true);
    expect(result.overrides.transport).toBe('stdio');
  });

  it('parses --port value into overrides.port', () => {
    const result = parseCliArgs(['--port', '4000']);
    expect(result.valid).toBe(true);
    expect(result.overrides.port).toBe('4000');
  });

  it('parses --log-level value into overrides.logLevel', () => {
    const result = parseCliArgs(['--log-level', 'debug']);
    expect(result.valid).toBe(true);
    expect(result.overrides.logLevel).toBe('debug');
  });

  it('parses --api-key-file into apiKeyFile (path only, never a secret)', () => {
    const result = parseCliArgs(['--api-key-file', '/run/secrets/api_key']);
    expect(result.valid).toBe(true);
    expect(result.apiKeyFile).toBe('/run/secrets/api_key');
    expect(result.overrides.apiKey).toBeUndefined();
  });

  it('parses --mcp-api-key-file into mcpApiKeyFile', () => {
    const result = parseCliArgs(['--mcp-api-key-file', '/run/secrets/mcp_key']);
    expect(result.valid).toBe(true);
    expect(result.mcpApiKeyFile).toBe('/run/secrets/mcp_key');
    expect(result.overrides.mcpApiKey).toBeUndefined();
  });

  it('parses --no-elicitation into overrides.useElicitation = "false"', () => {
    const result = parseCliArgs(['--no-elicitation']);
    expect(result.valid).toBe(true);
    expect(result.overrides.useElicitation).toBe('false');
  });

  it('parses --no-sampling into overrides.useSampling = "false"', () => {
    const result = parseCliArgs(['--no-sampling']);
    expect(result.valid).toBe(true);
    expect(result.overrides.useSampling).toBe('false');
  });

  it('combines multiple flags in one argv', () => {
    const result = parseCliArgs([
      '--provider', 'openai',
      '--transport', 'http',
      '--port', '3001',
      '--no-elicitation',
      '--no-sampling',
    ]);
    expect(result.valid).toBe(true);
    expect(result.overrides).toEqual({
      provider: 'openai',
      transport: 'http',
      port: '3001',
      useElicitation: 'false',
      useSampling: 'false',
    });
  });

  it.each([
    ['--api-key', 'sk-raw-secret-value'],
    ['--mcp-api-key', 'some-bearer-token'],
  ])('rejects raw secret flag %s with a non-empty error', (flag, value) => {
    const result = parseCliArgs([flag, value]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain(flag);
    expect(result.errors[0].toLowerCase()).toContain('secret');
  });

  it('rejects --api-key even without a following value', () => {
    const result = parseCliArgs(['--api-key']);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('--api-key');
  });

  it('rejects unknown options', () => {
    const result = parseCliArgs(['--totally-unknown-flag']);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Unknown option');
    expect(result.errors[0]).toContain('--totally-unknown-flag');
  });

  it('reports a missing-value error for a value flag at end of argv', () => {
    const result = parseCliArgs(['--provider']);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('--provider');
    expect(result.errors[0]).toContain('requires a value');
  });

  it('reports a missing-value error when the next token looks like another flag', () => {
    const result = parseCliArgs(['--provider', '--transport', 'stdio']);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('--provider'))).toBe(true);
  });

  it('accumulates multiple errors across several bad options', () => {
    const result = parseCliArgs(['--unknown-one', '--api-key', 'x', '--unknown-two']);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('does not mutate a shared frozen-like input array', () => {
    const argv = Object.freeze(['--provider', 'openai']);
    expect(() => parseCliArgs(argv)).not.toThrow();
  });
});
