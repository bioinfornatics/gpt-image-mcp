import OpenAI from 'openai';
import { Logger } from '@nestjs/common';
import type {
  IImageProvider,
  GenerateParams,
  EditParams,
  VariationParams,
  ImageResult,
  ValidationResult,
} from './provider.interface';
import type { ProviderStrategy } from './strategies/provider.strategy';
import { maskSecret } from '../security/sanitise';

/**
 * Single provider implementation for all OpenAI-compatible APIs.
 *
 * Both OpenAI and Azure use the same `openai` npm SDK under the hood —
 * Azure is just `new OpenAI({ baseURL: endpoint + '/openai/v1' })`.
 * The ProviderStrategy captures the handful of decisions that differ
 * (model resolution, extra params, error messages, variation support).
 *
 * To add a new OpenAI-compatible provider (Groq, Together, Mistral…):
 *   1. Write a new ProviderStrategy implementation
 *   2. Add a branch in providers.module.ts
 *   3. Zero changes here
 */
export class OpenAICompatibleProvider implements IImageProvider {
  private readonly logger: Logger;

  constructor(
    private readonly client: OpenAI,
    private readonly strategy: ProviderStrategy,
  ) {
    this.logger = new Logger(`OpenAICompatibleProvider[${strategy.name}]`);
  }

  get name(): 'openai' | 'azure' {
    return this.strategy.name;
  }

  // ─── generate ────────────────────────────────────────────────────────────

  async generate(params: GenerateParams): Promise<ImageResult[]> {
    const model = this.strategy.resolveModel(params);
    this.logger.log(`${this.strategy.logPrefix} generate model=${model} n=${params.n ?? 1}`);
    try {
      const extras = this.strategy.buildGenerateExtras(params, model);
      const response = await this.client.images.generate({
        prompt: params.prompt,
        model,
        n: params.n,
        size: params.size as Parameters<OpenAI['images']['generate']>[0]['size'],
        quality: params.quality as Parameters<OpenAI['images']['generate']>[0]['quality'],
        ...extras,
      } as Parameters<OpenAI['images']['generate']>[0]);

      return this.mapResponse(response, model);
    } catch (err) {
      this.logger.error(`${this.strategy.logPrefix} generate failed: ${maskSecret(String(err))}`);
      throw this.strategy.normalizeError(err);
    }
  }

  // ─── edit ─────────────────────────────────────────────────────────────────

  async edit(params: EditParams): Promise<ImageResult[]> {
    const model = this.strategy.resolveModel(params);
    this.logger.log(`${this.strategy.logPrefix} edit model=${model}`);
    try {
      const imageFile = await this.base64ToFile(params.image, 'image.png', 'image/png');
      const maskFile = params.mask
        ? await this.base64ToFile(params.mask, 'mask.png', 'image/png')
        : undefined;
      const extras = this.strategy.buildEditExtras(params);

      const response = await this.client.images.edit({
        image: imageFile,
        ...(maskFile ? { mask: maskFile } : {}),
        prompt: params.prompt,
        model,
        n: params.n,
        size: params.size as Parameters<OpenAI['images']['edit']>[0]['size'],
        ...extras,
      } as Parameters<OpenAI['images']['edit']>[0]);

      return this.mapResponse(response, model);
    } catch (err) {
      this.logger.error(`${this.strategy.logPrefix} edit failed: ${maskSecret(String(err))}`);
      throw this.strategy.normalizeError(err);
    }
  }

  // ─── variation ────────────────────────────────────────────────────────────

  async variation(params: VariationParams): Promise<ImageResult[]> {
    if (!this.strategy.supportsVariation) {
      throw new Error(
        `image_variation is not supported by the ${this.strategy.name} provider. Use image_generate instead.`,
      );
    }
    this.logger.log(`variation n=${params.n ?? 1}`);
    try {
      const imageFile = await this.base64ToFile(params.image, 'image.png', 'image/png');
      const response = await this.client.images.createVariation({
        image: imageFile,
        n: params.n,
        size: params.size as Parameters<OpenAI['images']['createVariation']>[0]['size'],
        response_format: 'b64_json',
      });
      return this.mapResponse(response, 'dall-e-2');
    } catch (err) {
      this.logger.error(`variation failed: ${maskSecret(String(err))}`);
      throw this.strategy.normalizeError(err);
    }
  }

  // ─── validate ─────────────────────────────────────────────────────────────

  async validate(): Promise<ValidationResult> {
    try {
      await this.client.models.list();
      return { valid: true, provider: this.strategy.name };
    } catch (err) {
      return {
        valid: false,
        provider: this.strategy.name,
        error: maskSecret(String(err)),
      };
    }
  }

  // ─── shared utilities ─────────────────────────────────────────────────────

  private mapResponse(
    response: { data?: Array<{ b64_json?: string | null; revised_prompt?: string | null }>; created?: number },
    model: string,
  ): ImageResult[] {
    return (response.data ?? []).map((img) => ({
      b64_json: img.b64_json ?? '',
      revised_prompt: img.revised_prompt ?? undefined,
      model,
      created: response.created ?? Date.now(),
    }));
  }

  private async base64ToFile(b64: string, filename: string, mimeType: string): Promise<File> {
    const base64Data = b64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    return new File([buffer], filename, { type: mimeType });
  }
}
