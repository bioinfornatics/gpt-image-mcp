import Joi from 'joi';
import { LATEST_MODEL } from './models';

export type ProviderName = 'openai' | 'azure' | 'together' | 'custom';

export interface AppConfig {
  imageProvider: {
    name: ProviderName;
    apiKey?: string;
    baseUrl: string;
    deployment?: string;
    apiVersion: string;
    models: string[];
  };
  mcp: {
    transport: 'http' | 'stdio';
    port: number;
    apiKey?: string;
    requireMcpAuth: boolean;
    useElicitation: boolean;
    useSampling: boolean;
  };
  defaults: {
    model: string;
  };
  security: {
    maxRequestsPerMinute: number;
  };
  logLevel: string;
}

export const configValidationSchema = Joi.object({
  // Secret backend selection (resolved before validation, so not in AppConfig)
  MCP_SECRET_BACKEND: Joi.string().valid('file', 'keytar', 'env').optional().default('file'),

  // ── Image provider ────────────────────────────────────────────────────────
  IMAGE_PROVIDER: Joi.string().valid('openai', 'azure', 'together', 'custom').required().messages({
    'any.required': 'IMAGE_PROVIDER is required (openai|azure|together|custom)',
    'any.only': 'IMAGE_PROVIDER must be "openai", "azure", "together", or "custom"',
  }),

  // API key: required for openai / azure / together; optional for custom (keyless endpoints)
  IMAGE_API_KEY: Joi.when('IMAGE_PROVIDER', {
    is: Joi.valid('openai', 'azure', 'together'),
    then: Joi.string().required().messages({
      'any.required': 'IMAGE_API_KEY is required for the configured IMAGE_PROVIDER',
    }),
    otherwise: Joi.string().optional(),
  }),

  // Base URL / endpoint:
  //   azure  → required (e.g. https://my-resource.openai.azure.com)
  //   custom → required (your OpenAI-compatible endpoint)
  //   openai → optional, defaults to https://api.openai.com/v1 in the factory
  //   together → not used (hardcoded in strategy)
  IMAGE_BASE_URL: Joi.when('IMAGE_PROVIDER', {
    switch: [
      {
        is: 'azure',
        then: Joi.string().uri().required().messages({
          'any.required':
            'IMAGE_BASE_URL is required when IMAGE_PROVIDER=azure (e.g. https://my-resource.openai.azure.com)',
        }),
      },
      {
        is: 'custom',
        then: Joi.string().uri().required().messages({
          'any.required': 'IMAGE_BASE_URL is required when IMAGE_PROVIDER=custom',
        }),
      },
    ],
    otherwise: Joi.string().uri().optional(),
  }),

  // Azure-specific
  IMAGE_DEPLOYMENT: Joi.when('IMAGE_PROVIDER', {
    is: 'azure',
    then: Joi.string().required().messages({
      'any.required': 'IMAGE_DEPLOYMENT is required when IMAGE_PROVIDER=azure',
    }),
    otherwise: Joi.string().optional(),
  }),
  IMAGE_API_VERSION: Joi.string().optional().default('2025-04-01-preview'),

  // Custom-provider model list (comma-separated)
  IMAGE_MODELS: Joi.string().optional().default('custom'),

  // Default model for generation requests
  IMAGE_DEFAULT_MODEL: Joi.string().optional().default(LATEST_MODEL),

  // ── Deprecated aliases — accepted silently so old .env files don't crash ─
  // resolveImageEnvAliases() in secret-loader.ts already migrated these to
  // IMAGE_* names before Joi runs. These rules just prevent "unknown key" errors.
  PROVIDER: Joi.string().optional(),
  OPENAI_API_KEY: Joi.string().optional(),
  OPENAI_BASE_URL: Joi.string().uri().optional(),
  AZURE_OPENAI_ENDPOINT: Joi.string().uri().optional(),
  AZURE_OPENAI_API_KEY: Joi.string().optional(),
  AZURE_OPENAI_DEPLOYMENT: Joi.string().optional(),
  AZURE_OPENAI_API_VERSION: Joi.string().optional(),
  TOGETHER_API_KEY: Joi.string().optional(),
  CUSTOM_OPENAI_BASE_URL: Joi.string().uri().optional(),
  CUSTOM_OPENAI_API_KEY: Joi.string().optional(),
  CUSTOM_OPENAI_MODELS: Joi.string().optional(),
  DEFAULT_MODEL: Joi.string().optional(),

  // ── MCP ───────────────────────────────────────────────────────────────────
  MCP_TRANSPORT: Joi.string().valid('http', 'stdio').optional().default('http'),
  PORT: Joi.number().integer().min(1).max(65535).optional().default(3000),
  REQUIRE_MCP_AUTH: Joi.boolean().optional().default(true),
  MCP_API_KEY: Joi.when('REQUIRE_MCP_AUTH', {
    is: true,
    then: Joi.string().min(16).required().messages({
      'any.required':
        'MCP_API_KEY is required when REQUIRE_MCP_AUTH=true (default). Set REQUIRE_MCP_AUTH=false to allow unauthenticated access (local dev only).',
      'string.min': 'MCP_API_KEY must be at least 16 characters.',
    }),
    otherwise: Joi.string().optional(),
  }),

  // ── Features ──────────────────────────────────────────────────────────────
  USE_ELICITATION: Joi.boolean().optional().default(true),
  USE_SAMPLING: Joi.boolean().optional().default(true),

  // ── Security ──────────────────────────────────────────────────────────────
  MAX_REQUESTS_PER_MINUTE: Joi.number().integer().min(1).optional().default(60),

  // ── Logging ───────────────────────────────────────────────────────────────
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').optional().default('info'),
});

export const appConfig = (): AppConfig => ({
  imageProvider: {
    name: (process.env['IMAGE_PROVIDER'] as ProviderName) || 'openai',
    apiKey: process.env['IMAGE_API_KEY'],
    baseUrl: process.env['IMAGE_BASE_URL'] || 'https://api.openai.com/v1',
    deployment: process.env['IMAGE_DEPLOYMENT'],
    apiVersion: process.env['IMAGE_API_VERSION'] || '2025-04-01-preview',
    models: (process.env['IMAGE_MODELS'] || 'custom').split(',').map((s) => s.trim()),
  },
  mcp: {
    transport: (process.env['MCP_TRANSPORT'] as 'http' | 'stdio') || 'http',
    port: parseInt(process.env['PORT'] || '3000', 10),
    apiKey: process.env['MCP_API_KEY'],
    requireMcpAuth: process.env['REQUIRE_MCP_AUTH'] !== 'false',
    useElicitation: process.env['USE_ELICITATION'] !== 'false',
    useSampling: process.env['USE_SAMPLING'] !== 'false',
  },
  defaults: {
    model: process.env['IMAGE_DEFAULT_MODEL'] || LATEST_MODEL,
  },
  security: {
    maxRequestsPerMinute: parseInt(process.env['MAX_REQUESTS_PER_MINUTE'] || '60', 10),
  },
  logLevel: process.env['LOG_LEVEL'] || 'info',
});
