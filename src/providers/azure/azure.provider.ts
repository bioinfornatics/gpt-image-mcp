import { AzureOpenAI } from 'openai';
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

export interface AzureProviderConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  apiVersion: string;
}

export class AzureOpenAIProvider implements IImageProvider {
  readonly name = 'azure' as const;
  private readonly client: AzureOpenAI;
  private readonly deployment: string;
  private readonly logger = new Logger(AzureOpenAIProvider.name);

  constructor(config: AzureProviderConfig) {
    this.deployment = config.deployment;
    this.client = new AzureOpenAI({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
      deployment: config.deployment,
    });
  }

  async generate(params: GenerateParams): Promise<ImageResult[]> {
    this.logger.log(`[Azure] Generating image deployment=${this.deployment}`);
    try {
      const response = await this.client.images.generate({
        prompt: params.prompt,
        model: this.deployment,
        n: params.n,
        size: params.size as Parameters<AzureOpenAI['images']['generate']>[0]['size'],
        quality: params.quality as Parameters<AzureOpenAI['images']['generate']>[0]['quality'],
        response_format: 'b64_json' as const,
      });

      return (response.data ?? []).map((img) => ({
        b64_json: img.b64_json ?? '',
        revised_prompt: img.revised_prompt,
        model: this.deployment,
        created: response.created ?? Date.now(),
      }));
    } catch (err) {
      this.logger.error(`[Azure] Generation failed: ${maskSecret(String(err))}`);
      throw this.normalizeError(err);
    }
  }

  async edit(params: EditParams): Promise<ImageResult[]> {
    this.logger.log(`[Azure] Editing image deployment=${this.deployment}`);
    try {
      const imageFile = await this.base64ToFile(params.image, 'image.png', 'image/png');
      const maskFile = params.mask
        ? await this.base64ToFile(params.mask, 'mask.png', 'image/png')
        : undefined;

      const response = await this.client.images.edit({
        image: imageFile,
        mask: maskFile,
        prompt: params.prompt,
        model: this.deployment,
        n: params.n,
        size: params.size as Parameters<AzureOpenAI['images']['edit']>[0]['size'],
        response_format: 'b64_json' as const,
      });

      return (response.data ?? []).map((img) => ({
        b64_json: img.b64_json ?? '',
        model: this.deployment,
        created: response.created ?? Date.now(),
      }));
    } catch (err) {
      this.logger.error(`[Azure] Edit failed: ${maskSecret(String(err))}`);
      throw this.normalizeError(err);
    }
  }

  async variation(_params: VariationParams): Promise<ImageResult[]> {
    throw new Error('image_variation is not supported by Azure OpenAI. Use image_generate instead.');
  }

  async validate(): Promise<ValidationResult> {
    try {
      // Minimal check: list deployments or call models
      await this.client.models.list();
      return { valid: true, provider: 'azure', models: [this.deployment] };
    } catch (err) {
      return {
        valid: false,
        provider: 'azure',
        error: maskSecret(String(err)),
      };
    }
  }

  private normalizeError(err: unknown): Error {
    if (err instanceof Error) {
      const msg = maskSecret(err.message);
      if (msg.includes('429') || msg.toLowerCase().includes('rate limit')) {
        return new Error(`Rate limit exceeded (Azure): ${msg}. Please wait before retrying.`);
      }
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        return new Error('Authentication failed: invalid API key for Azure OpenAI provider.');
      }
      if (msg.includes('403') || msg.toLowerCase().includes('forbidden')) {
        return new Error(
          `Access denied (Azure): ${msg}. ` +
          `If using gpt-image-2, this model requires explicit access approval — ` +
          `request access via the Azure portal before using it.`,
        );
      }
      if (msg.includes('404')) {
        return new Error(`Deployment not found: ${this.deployment}. Check AZURE_OPENAI_DEPLOYMENT.`);
      }
      return new Error(`Azure OpenAI error: ${msg}`);
    }
    return new Error(String(err));
  }

  private async base64ToFile(b64: string, filename: string, mimeType: string): Promise<File> {
    const base64Data = b64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    return new File([buffer], filename, { type: mimeType });
  }
}
