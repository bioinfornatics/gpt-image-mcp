import { configValidationSchema } from '../../../src/config/app.config';
import { LATEST_MODEL } from '../../../src/config/models';

function validateConfig(env: Record<string, string>) {
  const { error, value } = configValidationSchema.validate(env, { abortEarly: false });
  if (error) throw new Error(error.details.map((d) => d.message).join('; '));
  return value;
}

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
      expect(() => validateConfig({ PROVIDER: 'openai' })).toThrow(/OPENAI_API_KEY is required/);
    });

    it('should pass with valid OpenAI config', () => {
      const result = validateConfig({ PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' });
      expect(result.PROVIDER).toBe('openai');
      expect(result.OPENAI_API_KEY).toBe('sk-test');
    });

    it('should apply default OPENAI_BASE_URL', () => {
      const result = validateConfig({ PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' });
      expect(result.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    });
  });

  describe('Azure provider', () => {
    const baseAzure = {
      PROVIDER: 'azure',
      AZURE_OPENAI_API_KEY: 'test-key',
      AZURE_OPENAI_DEPLOYMENT: 'my-deployment',
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
    const openai = { PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test' };

    it('should default MCP_TRANSPORT to http', () => {
      expect(validateConfig(openai).MCP_TRANSPORT).toBe('http');
    });

    it('should default PORT to 3000', () => {
      expect(validateConfig(openai).PORT).toBe(3000);
    });

    it('should default DEFAULT_MODEL to LATEST_MODEL', () => {
      expect(validateConfig(openai).DEFAULT_MODEL).toBe(LATEST_MODEL);
    });

    it('should default MAX_REQUESTS_PER_MINUTE to 60', () => {
      expect(validateConfig(openai).MAX_REQUESTS_PER_MINUTE).toBe(60);
    });
  });
});
