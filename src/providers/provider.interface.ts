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
  image: string; // base64
  mask?: string; // base64
  prompt: string;
  model: string;
  n?: number;
  size?: string;
  quality?: string;
  output_format?: 'png' | 'jpeg' | 'webp';
  output_compression?: number;
  input_fidelity?: 'low' | 'high';  // NEW — gpt-image-1.x identity preservation; MUST NOT be sent for gpt-image-2
}

export interface VariationParams {
  image: string; // base64
  n?: number;
  size?: string;
}

export interface ImageResult {
  b64_json: string;
  revised_prompt?: string;
  model: string;
  created: number;
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
  generate(params: GenerateParams): Promise<ImageResult[]>;
  edit(params: EditParams): Promise<ImageResult[]>;
  variation(params: VariationParams): Promise<ImageResult[]>;
  validate(): Promise<ValidationResult>;
}

export const PROVIDER_TOKEN = Symbol('IImageProvider');
