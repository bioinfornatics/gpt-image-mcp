import Joi from 'joi';

export interface AppConfig {
  provider: 'openai' | 'azure' | 'together' | 'custom';
  openai: {
    apiKey?: string;
    baseUrl: string;
  };
  azure: {
    endpoint?: string;
    apiKey?: string;
    deployment?: string;
    apiVersion: string;
  };
  together: {
    apiKey?: string;
  };
  custom: {
    baseUrl?: string;
    apiKey?: string;
    models: string[];
  };
  mcp: {
    transport: 'http' | 'stdio';
    port: number;
    apiKey?: string;
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

  PROVIDER: Joi.string().valid('openai', 'azure', 'together', 'custom').required().messages({
    'any.required': 'PROVIDER is required (openai|azure|together|custom)',
    'any.only': 'PROVIDER must be "openai", "azure", "together", or "custom"',
  }),

  // OpenAI
  OPENAI_API_KEY: Joi.when('PROVIDER', {
    is: 'openai',
    then: Joi.string().required().messages({
      'any.required': 'OPENAI_API_KEY is required when PROVIDER=openai',
    }),
    otherwise: Joi.string().optional(),
  }),
  OPENAI_BASE_URL: Joi.string().uri().optional().default('https://api.openai.com/v1'),

  // Azure OpenAI
  AZURE_OPENAI_ENDPOINT: Joi.when('PROVIDER', {
    is: 'azure',
    then: Joi.string().uri().required().messages({
      'any.required': 'AZURE_OPENAI_ENDPOINT is required when PROVIDER=azure',
    }),
    otherwise: Joi.string().uri().optional(),
  }),
  AZURE_OPENAI_API_KEY: Joi.when('PROVIDER', {
    is: 'azure',
    then: Joi.string().required().messages({
      'any.required': 'AZURE_OPENAI_API_KEY is required when PROVIDER=azure',
    }),
    otherwise: Joi.string().optional(),
  }),
  AZURE_OPENAI_DEPLOYMENT: Joi.when('PROVIDER', {
    is: 'azure',
    then: Joi.string().required().messages({
      'any.required': 'AZURE_OPENAI_DEPLOYMENT is required when PROVIDER=azure',
    }),
    otherwise: Joi.string().optional(),
  }),
  AZURE_OPENAI_API_VERSION: Joi.string().optional().default('2025-04-01-preview'),

  // Together AI
  TOGETHER_API_KEY: Joi.when('PROVIDER', {
    is: 'together',
    then: Joi.string().required().messages({
      'any.required': 'TOGETHER_API_KEY is required when PROVIDER=together',
    }),
    otherwise: Joi.string().optional(),
  }),

  // Custom OpenAI-compatible
  CUSTOM_OPENAI_BASE_URL: Joi.when('PROVIDER', {
    is: 'custom',
    then: Joi.string().uri().required().messages({
      'any.required': 'CUSTOM_OPENAI_BASE_URL is required when PROVIDER=custom',
    }),
    otherwise: Joi.string().uri().optional(),
  }),
  CUSTOM_OPENAI_API_KEY: Joi.string().optional().default('none'),
  CUSTOM_OPENAI_MODELS: Joi.string().optional().default('custom'),

  // MCP
  MCP_TRANSPORT: Joi.string().valid('http', 'stdio').optional().default('http'),
  PORT: Joi.number().integer().min(1).max(65535).optional().default(3000),
  MCP_API_KEY: Joi.string().optional(),

  // Features
  USE_ELICITATION: Joi.boolean().optional().default(true),
  USE_SAMPLING: Joi.boolean().optional().default(true),

  // Defaults
  DEFAULT_MODEL: Joi.string().optional().default('gpt-image-1'),

  // Security
  MAX_REQUESTS_PER_MINUTE: Joi.number().integer().min(1).optional().default(60),

  // Logging
  LOG_LEVEL: Joi.string().valid('debug', 'info', 'warn', 'error').optional().default('info'),
});

export const appConfig = (): AppConfig => ({
  provider: (process.env['PROVIDER'] as 'openai' | 'azure' | 'together' | 'custom') || 'openai',
  openai: {
    apiKey: process.env['OPENAI_API_KEY'],
    baseUrl: process.env['OPENAI_BASE_URL'] || 'https://api.openai.com/v1',
  },
  azure: {
    endpoint: process.env['AZURE_OPENAI_ENDPOINT'],
    apiKey: process.env['AZURE_OPENAI_API_KEY'],
    deployment: process.env['AZURE_OPENAI_DEPLOYMENT'],
    apiVersion: process.env['AZURE_OPENAI_API_VERSION'] || '2025-04-01-preview',
  },
  mcp: {
    transport: (process.env['MCP_TRANSPORT'] as 'http' | 'stdio') || 'http',
    port: parseInt(process.env['PORT'] || '3000', 10),
    apiKey: process.env['MCP_API_KEY'],
    useElicitation: process.env['USE_ELICITATION'] !== 'false',
    useSampling: process.env['USE_SAMPLING'] !== 'false',
  },
  defaults: {
    model: process.env['DEFAULT_MODEL'] || 'gpt-image-1',
  },
  security: {
    maxRequestsPerMinute: parseInt(process.env['MAX_REQUESTS_PER_MINUTE'] || '60', 10),
  },
  logLevel: process.env['LOG_LEVEL'] || 'info',
  together: {
    apiKey: process.env['TOGETHER_API_KEY'],
  },
  custom: {
    baseUrl: process.env['CUSTOM_OPENAI_BASE_URL'],
    apiKey: process.env['CUSTOM_OPENAI_API_KEY'] || 'none',
    models: (process.env['CUSTOM_OPENAI_MODELS'] || 'custom').split(',').map(s => s.trim()),
  },
});
