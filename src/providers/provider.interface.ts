export interface GenerateParams {
  prompt: string;
  model: string;
  n?: number;
  size?: string;
  quality?: string;
  background?: 'transparent' | 'opaque' | 'auto';
  output_format?: 'png' | 'jpeg' | 'webp';
  output_compression?: number;
  moderation?: 'auto' | 'low';
}

export interface EditParams {
  image?: string;       // Changed: now optional (use images[] for compositing)
  images?: string[];    // NEW: array of base64 images for multi-image compositing
  mask?: string;        // base64
  prompt: string;
  model: string;
  n?: number;
  size?: string;
  quality?: string;
  output_format?: 'png' | 'jpeg' | 'webp';
  output_compression?: number;
  background?: 'transparent' | 'opaque' | 'auto';
  input_fidelity?: 'low' | 'high';  // gpt-image-1.x identity preservation; MUST NOT be sent for gpt-image-2
}

export interface VariationParams {
  image: string; // base64
  n?: number;
  size?: string;
}

export interface ImageResult {
  b64_json: string;
  format: 'png' | 'jpeg' | 'webp';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  revised_prompt?: string;
  model: string;
  created: number;
}

export type ProviderErrorStage = 'prompt' | 'output' | 'unknown';

export interface ImageProviderErrorOptions {
  code: string;
  message: string;
  provider: string;
  model: string;
  retryable: boolean;
  stage?: ProviderErrorStage;
  status?: number;
  providerCode?: string;
  label?: string;
  requestId?: string;
}

/** A safe, structured provider failure that MCP tools can expose without parsing text. */
export class ImageProviderError extends Error {
  readonly code: string;
  readonly provider: string;
  readonly model: string;
  readonly retryable: boolean;
  readonly stage: ProviderErrorStage;
  readonly status?: number;
  readonly providerCode?: string;
  readonly label?: string;
  readonly requestId?: string;

  constructor(options: ImageProviderErrorOptions) {
    super(options.message);
    this.name = 'ImageProviderError';
    this.code = options.code;
    this.provider = options.provider;
    this.model = options.model;
    this.retryable = options.retryable;
    this.stage = options.stage ?? 'unknown';
    this.status = options.status;
    this.providerCode = options.providerCode;
    this.label = options.label;
    this.requestId = options.requestId;
  }
}

export interface ValidationResult {
  [key: string]: unknown;
  valid: boolean;
  provider: string;
  error?: string;
  models?: string[];
}

export interface IImageProvider {
  readonly name: 'openai' | 'azure' | 'together' | 'custom';
  /** Fixed model/deployment selected by provider configuration, when callers cannot switch models per request. */
  readonly configuredModel?: string;
  /** Model selected when a caller omits model. */
  readonly defaultModel?: string;
  /** Models this provider can route within the running server instance. */
  readonly availableModels?: readonly string[];
  generate(params: GenerateParams): Promise<ImageResult[]>;
  edit(params: EditParams): Promise<ImageResult[]>;
  variation(params: VariationParams): Promise<ImageResult[]>;
  validate(): Promise<ValidationResult>;
}

export const PROVIDER_TOKEN = Symbol('IImageProvider');
