import OpenAI from 'openai';
import { Logger } from '@nestjs/common';
import type {
  IImageProvider,
  GenerateParams,
  EditParams,
  VariationParams,
  ImageResult,
  ValidationResult,
} from '../provider.interface';
import { maskSecret } from '../../security/sanitise';

export interface OpenAIProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

export class OpenAIProvider implements IImageProvider {
  readonly name = 'openai' as const;
  private readonly client: OpenAI;
  private readonly logger = new Logger(OpenAIProvider.name);

  constructor(config: OpenAIProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async generate(params: GenerateParams): Promise<ImageResult[]> {
    this.logger.log(`Generating image with model=${params.model} n=${params.n ?? 1}`);
    try {
      const isDallE = params.model.startsWith('dall-e');
      const response = await this.client.images.generate({
        prompt: params.prompt,
        model: params.model,
        n: params.n,
        size: params.size as Parameters<OpenAI['images']['generate']>[0]['size'],
        quality: params.quality as Parameters<OpenAI['images']['generate']>[0]['quality'],
        // For DALL-E models, must explicitly request b64_json (default is URL).
        // GPT-image models always return base64 and don't accept this param.
        ...(isDallE ? { response_format: 'b64_json' as const } : {
          background: params.background,
          output_format: params.output_format,
          output_compression: params.output_compression,
          moderation: params.moderation,
        }),
      } as Parameters<OpenAI['images']['generate']>[0]);

      return (response.data ?? []).map((img) => ({
        b64_json: img.b64_json ?? '',
        revised_prompt: img.revised_prompt,
        model: params.model,
        created: response.created ?? Date.now(),
      }));
    } catch (err) {
      this.logger.error(`Image generation failed: ${this.sanitizeError(err)}`);
      throw this.normalizeError(err);
    }
  }

  async edit(params: EditParams): Promise<ImageResult[]> {
    this.logger.log(`Editing image with model=${params.model}`);
    try {
      // Convert base64 to File objects for the SDK
      const imageFile = await this.base64ToFile(params.image, 'image.png', 'image/png');
      const maskFile = params.mask
        ? await this.base64ToFile(params.mask, 'mask.png', 'image/png')
        : undefined;

      const response = await this.client.images.edit({
        image: imageFile,
        mask: maskFile,
        prompt: params.prompt,
        model: params.model,
        n: params.n,
        size: params.size as Parameters<OpenAI['images']['edit']>[0]['size'],
        response_format: 'b64_json' as const,
      });

      return (response.data ?? []).map((img) => ({
        b64_json: img.b64_json ?? '',
        revised_prompt: img.revised_prompt,
        model: params.model,
        created: response.created ?? Date.now(),
      }));
    } catch (err) {
      this.logger.error(`Image edit failed: ${this.sanitizeError(err)}`);
      throw this.normalizeError(err);
    }
  }

  async variation(params: VariationParams): Promise<ImageResult[]> {
    this.logger.log(`Creating image variation n=${params.n ?? 1}`);
    try {
      const imageFile = await this.base64ToFile(params.image, 'image.png', 'image/png');

      const response = await this.client.images.createVariation({
        image: imageFile,
        n: params.n,
        size: params.size as Parameters<OpenAI['images']['createVariation']>[0]['size'],
        response_format: 'b64_json',
      });

      return (response.data ?? []).map((img) => ({
        b64_json: img.b64_json ?? '',
        model: 'dall-e-2',
        created: response.created ?? Date.now(),
      }));
    } catch (err) {
      this.logger.error(`Image variation failed: ${this.sanitizeError(err)}`);
      throw this.normalizeError(err);
    }
  }

  async validate(): Promise<ValidationResult> {
    try {
      // Lightweight validation: list models (doesn't generate an image)
      await this.client.models.list();
      return { valid: true, provider: 'openai' };
    } catch (err) {
      return {
        valid: false,
        provider: 'openai',
        error: this.sanitizeError(err),
      };
    }
  }

  private sanitizeError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    // Never expose actual API key values in error messages
    return maskSecret(message);
  }

  private normalizeError(err: unknown): Error {
    // Duck-type check: handles both real OpenAI.APIError and mocked versions
    if (err && typeof err === 'object' && 'status' in err && err instanceof Error) {
      const status = (err as { status: number }).status;
      const msg = maskSecret(err.message);
      if (status === 429) {
        return new Error(`Rate limit exceeded: ${msg}. Please wait before retrying.`);
      }
      if (status === 401) {
        return new Error('Authentication failed: invalid API key for OpenAI provider.');
      }
      if (status === 400) {
        return new Error(`Bad request: ${msg}`);
      }
      if (status === 404) {
        return new Error(`Model or resource not found: ${msg}`);
      }
      return new Error(`OpenAI API error (${status}): ${msg}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  private async base64ToFile(b64: string, filename: string, mimeType: string): Promise<File> {
    // Strip data URI prefix if present
    const base64Data = b64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    return new File([buffer], filename, { type: mimeType });
  }
}
