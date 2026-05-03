import { configValidationSchema, appConfig } from '../../../src/config/app.config';
import { LATEST_MODEL } from '../../../src/config/models';

function validateConfig(env: Record<string, string>) {
  const { error, value } = configValidationSchema.validate(env, { abortEarly: false });
  if (error) throw new Error(error.details.map((d) => d.message).join('; '));
  return value;
}

// Base valid OpenAI config that explicitly opts out of MCP auth requirement
// (no MCP_API_KEY in these unit tests)
const openaiBase = {
  PROVIDER: 'openai',
  OPENAI_API_KEY: 'sk-test',
  REQUIRE_MCP_AUTH: 'false',
};

describe('AppConfig validation', () => {
  describe('PROVIDER', () => {
    it('should throw when PROVIDER is missing', () => {
      expect(() => validateConfig({})).toThrow(/PROVIDER is required/);
    });

    it('should throw when PROVIDER is invalid', () => {
      expect(() => validateConfig({ PROVIDER: 'anthropic' })).toThrow(/must be/i);
    });
  });

  describe('OpenAI provider', () => {
    it('should throw when OPENAI_API_KEY is missing for provider=openai', () => {
      expect(() => validateConfig({ PROVIDER: 'openai', REQUIRE_MCP_AUTH: 'false' })).toThrow(/OPENAI_API_KEY is required/);
    });

    it('should pass with valid OpenAI config', () => {
      const result = validateConfig(openaiBase);
      expect(result.PROVIDER).toBe('openai');
      expect(result.OPENAI_API_KEY).toBe('sk-test');
    });

    it('should apply default OPENAI_BASE_URL', () => {
      const result = validateConfig(openaiBase);
      expect(result.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    });
  });

  describe('Azure provider', () => {
    const baseAzure = {
      PROVIDER: 'azure',
      AZURE_OPENAI_API_KEY: 'test-key',
      AZURE_OPENAI_DEPLOYMENT: 'my-deployment',
      REQUIRE_MCP_AUTH: 'false',
    };

    it('should throw when AZURE_OPENAI_ENDPOINT is missing', () => {
      expect(() => validateConfig(baseAzure)).toThrow(/AZURE_OPENAI_ENDPOINT is required/);
    });

    it('should throw when AZURE_OPENAI_API_KEY is missing', () => {
      expect(() =>
        validateConfig({
          PROVIDER: 'azure',
          AZURE_OPENAI_ENDPOINT: 'https://x.openai.azure.com',
          AZURE_OPENAI_DEPLOYMENT: 'dep',
          REQUIRE_MCP_AUTH: 'false',
        }),
      ).toThrow(/AZURE_OPENAI_API_KEY is required/);
    });

    it('should pass with complete Azure config', () => {
      const result = validateConfig({
        ...baseAzure,
        AZURE_OPENAI_ENDPOINT: 'https://test.openai.azure.com',
      });
      expect(result.PROVIDER).toBe('azure');
      expect(result.AZURE_OPENAI_API_VERSION).toBe('2025-04-01-preview');
    });
  });

  describe('Defaults', () => {
    it('should default MCP_TRANSPORT to http', () => {
      expect(validateConfig(openaiBase).MCP_TRANSPORT).toBe('http');
    });

    it('should default PORT to 3000', () => {
      expect(validateConfig(openaiBase).PORT).toBe(3000);
    });

    it('should default DEFAULT_MODEL to LATEST_MODEL', () => {
      expect(validateConfig(openaiBase).DEFAULT_MODEL).toBe(LATEST_MODEL);
    });

    it('should default MAX_REQUESTS_PER_MINUTE to 60', () => {
      expect(validateConfig(openaiBase).MAX_REQUESTS_PER_MINUTE).toBe(60);
    });
  });

  describe('REQUIRE_MCP_AUTH / MCP_API_KEY', () => {
    it('should default REQUIRE_MCP_AUTH to true', () => {
      // When not specified, Joi defaults REQUIRE_MCP_AUTH=true
      // and then requires MCP_API_KEY — so omitting both should throw
      expect(() =>
        validateConfig({ PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' }),
      ).toThrow(/MCP_API_KEY is required when REQUIRE_MCP_AUTH=true/);
    });

    it('should require MCP_API_KEY of at least 16 chars when REQUIRE_MCP_AUTH=true', () => {
      expect(() =>
        validateConfig({
          PROVIDER: 'openai',
          OPENAI_API_KEY: 'sk-test',
          REQUIRE_MCP_AUTH: 'true',
          MCP_API_KEY: 'tooshort',
        }),
      ).toThrow(/MCP_API_KEY must be at least 16 characters/);
    });

    it('should pass when REQUIRE_MCP_AUTH=true and MCP_API_KEY has 16+ chars', () => {
      const result = validateConfig({
        PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
        REQUIRE_MCP_AUTH: 'true',
        MCP_API_KEY: 'a-valid-key-16ch',
      });
      expect(result.REQUIRE_MCP_AUTH).toBe(true);
      expect(result.MCP_API_KEY).toBe('a-valid-key-16ch');
    });

    it('should pass when REQUIRE_MCP_AUTH=false with no MCP_API_KEY', () => {
      const result = validateConfig({
        PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
        REQUIRE_MCP_AUTH: 'false',
      });
      expect(result.REQUIRE_MCP_AUTH).toBe(false);
      expect(result.MCP_API_KEY).toBeUndefined();
    });

    it('should allow optional MCP_API_KEY when REQUIRE_MCP_AUTH=false', () => {
      const result = validateConfig({
        PROVIDER: 'openai',
        OPENAI_API_KEY: 'sk-test',
        REQUIRE_MCP_AUTH: 'false',
        MCP_API_KEY: 'optional-key',
      });
      expect(result.MCP_API_KEY).toBe('optional-key');
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

    it('should set requireMcpAuth=true when REQUIRE_MCP_AUTH is not set', () => {
      delete process.env['REQUIRE_MCP_AUTH'];
      const config = appConfig();
      expect(config.mcp.requireMcpAuth).toBe(true);
    });

    it('should set requireMcpAuth=false when REQUIRE_MCP_AUTH=false', () => {
      process.env['REQUIRE_MCP_AUTH'] = 'false';
      const config = appConfig();
      expect(config.mcp.requireMcpAuth).toBe(false);
    });

    it('should set requireMcpAuth=true when REQUIRE_MCP_AUTH=true', () => {
      process.env['REQUIRE_MCP_AUTH'] = 'true';
      const config = appConfig();
      expect(config.mcp.requireMcpAuth).toBe(true);
    });
  });
});
