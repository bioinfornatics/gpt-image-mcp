import { configValidationSchema, appConfig } from '../../../src/config/app.config';
import { LATEST_MODEL } from '../../../src/config/models';

function validateConfig(env: Record<string, string>) {
  const { error, value } = configValidationSchema.validate(env, { abortEarly: false });
  if (error) throw new Error(error.details.map((d) => d.message).join('; '));
  return value;
}

// Base valid OpenAI config that explicitly opts out of MCP auth requirement
// (no IMAGE_MCP_API_KEY in these unit tests)
const openaiBase = {
  IMAGE_PROVIDER: 'openai',
  IMAGE_API_KEY: 'sk-test',
  IMAGE_REQUIRE_MCP_AUTH: 'false',
};

describe('AppConfig validation', () => {
  describe('IMAGE_PROVIDER', () => {
    it('should throw when IMAGE_PROVIDER is missing', () => {
      expect(() => validateConfig({ IMAGE_REQUIRE_MCP_AUTH: 'false' })).toThrow(/IMAGE_PROVIDER is required/);
    });

    it('should throw when IMAGE_PROVIDER is invalid', () => {
      expect(() => validateConfig({ IMAGE_PROVIDER: 'anthropic', IMAGE_REQUIRE_MCP_AUTH: 'false' })).toThrow(/must be/i);
    });
  });

  describe('OpenAI provider', () => {
    it('should throw when IMAGE_API_KEY is missing for provider=openai', () => {
      expect(() => validateConfig({ IMAGE_PROVIDER: 'openai', IMAGE_REQUIRE_MCP_AUTH: 'false' })).toThrow(/IMAGE_API_KEY is required/);
    });

    it('should pass with valid OpenAI config', () => {
      const result = validateConfig(openaiBase);
      expect(result.IMAGE_PROVIDER).toBe('openai');
      expect(result.IMAGE_API_KEY).toBe('sk-test');
    });

    it('should apply default IMAGE_BASE_URL as openai.com', () => {
      const result = validateConfig(openaiBase);
      // IMAGE_BASE_URL is optional for openai — not defaulted by Joi (factory defaults it)
      expect(result.IMAGE_PROVIDER).toBe('openai');
    });
  });

  describe('OpenRouter provider', () => {
    it('accepts OpenRouter with a key and defaults its base URL', () => {
      const result = validateConfig({ IMAGE_PROVIDER: 'openrouter', IMAGE_API_KEY: 'or-key', IMAGE_MCP_TRANSPORT: 'stdio' });
      expect(result.IMAGE_BASE_URL).toBe('https://openrouter.ai/api/v1');
    });

    it('requires an API key', () => {
      expect(() => validateConfig({ IMAGE_PROVIDER: 'openrouter', IMAGE_MCP_TRANSPORT: 'stdio' })).toThrow(/IMAGE_API_KEY/);
    });
  });

  describe('Azure provider', () => {
    const baseAzure = {
      IMAGE_PROVIDER: 'azure',
      IMAGE_API_KEY: 'test-key',
      IMAGE_DEPLOYMENT: 'my-deployment',
      IMAGE_REQUIRE_MCP_AUTH: 'false',
    };

    it('should throw when IMAGE_BASE_URL is missing for azure', () => {
      expect(() => validateConfig(baseAzure)).toThrow(/IMAGE_BASE_URL is required when IMAGE_PROVIDER=azure/);
    });

    it('should throw when IMAGE_API_KEY is missing for azure', () => {
      expect(() =>
        validateConfig({
          IMAGE_PROVIDER: 'azure',
          IMAGE_BASE_URL: 'https://x.openai.azure.com',
          IMAGE_DEPLOYMENT: 'dep',
          IMAGE_AZURE_AUTH_MODE: 'api_key',
          IMAGE_REQUIRE_MCP_AUTH: 'false',
        }),
      ).toThrow(/IMAGE_API_KEY is required/);
    });

    it('accepts a separate HTTPS Foundry project endpoint for discovery', () => {
      const result = validateConfig({ ...baseAzure,
        IMAGE_BASE_URL: 'https://test.openai.azure.com',
        IMAGE_FOUNDRY_PROJECT_ENDPOINT: 'https://test.services.ai.azure.com/api/projects/project-a',
      });
      expect(result.IMAGE_FOUNDRY_PROJECT_ENDPOINT).toContain('/api/projects/project-a');
    });

    it('rejects a non-project discovery endpoint', () => {
      expect(() => validateConfig({ ...baseAzure,
        IMAGE_BASE_URL: 'https://test.openai.azure.com',
        IMAGE_FOUNDRY_PROJECT_ENDPOINT: 'https://test.openai.azure.com',
      })).toThrow(/Foundry project endpoint/);
    });

    it('should pass with complete Azure config', () => {
      const result = validateConfig({
        ...baseAzure,
        IMAGE_BASE_URL: 'https://test.openai.azure.com',
      });
      expect(result.IMAGE_PROVIDER).toBe('azure');
      expect(result.IMAGE_API_VERSION).toBe('2025-04-01-preview');
    });
  });

  describe('Azure authentication modes', () => {
    const azure = {
      IMAGE_PROVIDER: 'azure', IMAGE_BASE_URL: 'https://x.openai.azure.com',
      IMAGE_DEPLOYMENT: 'dep', IMAGE_MCP_TRANSPORT: 'stdio',
    };

    it('infers api_key only for compatible legacy Azure configuration', () => {
      expect(validateConfig({ ...azure, IMAGE_API_KEY: 'legacy-key' }).IMAGE_AZURE_AUTH_MODE).toBe('api_key');
    });

    it.each(['azure_cli', 'az-cli'])("accepts keyless Azure CLI mode %s", (mode) => {
      expect(validateConfig({ ...azure, IMAGE_AZURE_AUTH_MODE: mode }).IMAGE_AZURE_AUTH_MODE).toBe('azure_cli');
    });

    it('never infers Azure CLI when the key and mode are absent', () => {
      expect(() => validateConfig(azure)).toThrow(/never inferred automatically/);
    });

    it('rejects Azure modes for non-Azure providers', () => {
      expect(() => validateConfig({ ...openaiBase, IMAGE_AZURE_AUTH_MODE: 'azure_cli' })).toThrow(/only valid/);
    });

    it('rejects shared deployment discovery in on-behalf-of mode', () => {
      expect(() => validateConfig({
        ...azure,
        IMAGE_AZURE_AUTH_MODE: 'on_behalf_of',
        IMAGE_MCP_TRANSPORT: 'http',
        IMAGE_MCP_AUTH_MODE: 'entra',
        IMAGE_FOUNDRY_PROJECT_ENDPOINT: 'https://x.services.ai.azure.com/api/projects/p',
        IMAGE_ENTRA_TENANT_ID: 'tenant', IMAGE_ENTRA_CLIENT_ID: 'client',
        IMAGE_ENTRA_AUDIENCE: 'audience', IMAGE_ENTRA_CLIENT_SECRET: 'secret',
      })).toThrow(/not supported with on_behalf_of/);
    });

    it('requires an API key in explicit api_key mode', () => {
      expect(() => validateConfig({ ...azure, IMAGE_AZURE_AUTH_MODE: 'api_key' })).toThrow(/IMAGE_API_KEY is required/);
    });
  });

  describe('Defaults', () => {
    it('should default IMAGE_MCP_TRANSPORT to http', () => {
      expect(validateConfig(openaiBase).IMAGE_MCP_TRANSPORT).toBe('http');
    });

    it('should default IMAGE_PORT to 3000', () => {
      expect(validateConfig(openaiBase).IMAGE_PORT).toBe(3000);
    });

    it('should default IMAGE_DEFAULT_MODEL to LATEST_MODEL', () => {
      expect(validateConfig(openaiBase).IMAGE_DEFAULT_MODEL).toBe(LATEST_MODEL);
    });

    it('should default IMAGE_MAX_REQUESTS_PER_MINUTE to 60', () => {
      expect(validateConfig(openaiBase).IMAGE_MAX_REQUESTS_PER_MINUTE).toBe(60);
    });
  });

  describe('IMAGE_REQUIRE_MCP_AUTH / IMAGE_MCP_API_KEY', () => {
    it('should require authentication by default for HTTP', () => {
      expect(() =>
        validateConfig({ IMAGE_PROVIDER: 'openai', IMAGE_API_KEY: 'sk-test' }),
      ).toThrow(/IMAGE_MCP_API_KEY is required for HTTP/);
    });

    it('should not require IMAGE_MCP_API_KEY for stdio', () => {
      const result = validateConfig({
        IMAGE_PROVIDER: 'openai',
        IMAGE_API_KEY: 'sk-test',
        IMAGE_MCP_TRANSPORT: 'stdio',
      });
      expect(result.IMAGE_MCP_TRANSPORT).toBe('stdio');
      expect(result.IMAGE_MCP_API_KEY).toBeUndefined();
    });

    it('should require IMAGE_MCP_API_KEY of at least 16 chars when IMAGE_REQUIRE_MCP_AUTH=true', () => {
      expect(() =>
        validateConfig({
          IMAGE_PROVIDER: 'openai',
          IMAGE_API_KEY: 'sk-test',
          IMAGE_REQUIRE_MCP_AUTH: 'true',
          IMAGE_MCP_API_KEY: 'tooshort',
        }),
      ).toThrow(/IMAGE_MCP_API_KEY must be at least 16 characters/);
    });

    it('should pass when IMAGE_REQUIRE_MCP_AUTH=true and IMAGE_MCP_API_KEY has 16+ chars', () => {
      const result = validateConfig({
        IMAGE_PROVIDER: 'openai',
        IMAGE_API_KEY: 'sk-test',
        IMAGE_REQUIRE_MCP_AUTH: 'true',
        IMAGE_MCP_API_KEY: 'a-valid-key-16ch',
      });
      expect(result.IMAGE_REQUIRE_MCP_AUTH).toBe(true);
      expect(result.IMAGE_MCP_API_KEY).toBe('a-valid-key-16ch');
    });

    it('should pass when IMAGE_REQUIRE_MCP_AUTH=false with no IMAGE_MCP_API_KEY', () => {
      const result = validateConfig({
        IMAGE_PROVIDER: 'openai',
        IMAGE_API_KEY: 'sk-test',
        IMAGE_REQUIRE_MCP_AUTH: 'false',
      });
      expect(result.IMAGE_REQUIRE_MCP_AUTH).toBe(false);
      expect(result.IMAGE_MCP_API_KEY).toBeUndefined();
    });

    it('should allow optional IMAGE_MCP_API_KEY when IMAGE_REQUIRE_MCP_AUTH=false', () => {
      const result = validateConfig({
        IMAGE_PROVIDER: 'openai',
        IMAGE_API_KEY: 'sk-test',
        IMAGE_REQUIRE_MCP_AUTH: 'false',
        IMAGE_MCP_API_KEY: 'optional-key',
      });
      expect(result.IMAGE_MCP_API_KEY).toBe('optional-key');
    });
  });

  describe('appConfig() factory', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should set requireMcpAuth=true when IMAGE_REQUIRE_MCP_AUTH is not set', () => {
      delete process.env['IMAGE_REQUIRE_MCP_AUTH'];
      const config = appConfig();
      expect(config.mcp.requireMcpAuth).toBe(true);
    });

    it('should set requireMcpAuth=false when IMAGE_REQUIRE_MCP_AUTH=false', () => {
      process.env['IMAGE_REQUIRE_MCP_AUTH'] = 'false';
      const config = appConfig();
      expect(config.mcp.requireMcpAuth).toBe(false);
    });

    it('should set requireMcpAuth=true when IMAGE_REQUIRE_MCP_AUTH=true over HTTP', () => {
      process.env['IMAGE_MCP_TRANSPORT'] = 'http';
      process.env['IMAGE_REQUIRE_MCP_AUTH'] = 'true';
      const config = appConfig();
      expect(config.mcp.requireMcpAuth).toBe(true);
    });

    it('should always disable HTTP bearer authentication for stdio', () => {
      process.env['IMAGE_MCP_TRANSPORT'] = 'stdio';
      process.env['IMAGE_REQUIRE_MCP_AUTH'] = 'true';
      const config = appConfig();
      expect(config.mcp.requireMcpAuth).toBe(false);
    });

    it('should read IMAGE_PROVIDER into imageProvider.name', () => {
      process.env['IMAGE_PROVIDER'] = 'together';
      process.env['IMAGE_API_KEY'] = 'sk-together';
      const config = appConfig();
      expect(config.imageProvider.name).toBe('together');
    });

    it('should default imageProvider.baseUrl to openai when IMAGE_BASE_URL unset', () => {
      delete process.env['IMAGE_BASE_URL'];
      const config = appConfig();
      expect(config.imageProvider.baseUrl).toBe('https://api.openai.com/v1');
    });

    it('should split IMAGE_MODELS by comma into an array', () => {
      process.env['IMAGE_MODELS'] = 'model-a, model-b, model-c';
      const config = appConfig();
      expect(config.imageProvider.models).toEqual(['model-a', 'model-b', 'model-c']);
    });
  });
});
