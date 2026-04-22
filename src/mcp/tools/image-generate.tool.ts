import { Injectable, Inject, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PROVIDER_TOKEN } from '../../providers/provider.interface';
import type { IImageProvider, ImageResult } from '../../providers/provider.interface';
import { ElicitationService } from '../features/elicitation.service';
import { SamplingService } from '../features/sampling.service';
import { RootsService } from '../features/roots.service';
import { ImageGenerateSchema, ResponseFormat } from './schemas';

@Injectable()
export class ImageGenerateTool {
  private readonly logger = new Logger(ImageGenerateTool.name);

  constructor(
    @Inject(PROVIDER_TOKEN) private readonly provider: IImageProvider,
    private readonly elicitation: ElicitationService,
    private readonly sampling: SamplingService,
    private readonly roots: RootsService,
  ) {}

  register(server: McpServer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).registerTool(
      'image_generate',
      {
        title: 'Generate Image',
        description: `Generate one or more images from a text prompt using OpenAI or Azure OpenAI gpt-image-* models.

Supported models: gpt-image-1 (default), gpt-image-1.5, gpt-image-1-mini, dall-e-3, dall-e-2.

Args:
  - prompt (string, required): Text description, max 32 000 chars for GPT models
  - model (string, optional): Model identifier, default: gpt-image-1
  - n (integer 1–10, optional): Number of images, default: 1 (dall-e-3 only supports n=1)
  - size (string, optional): auto|1024x1024|1536x1024|1024x1536|..., default: auto
  - quality (string, optional): auto|high|medium|low|hd|standard, default: auto
  - background (string, optional): auto|transparent|opaque (GPT models only)
  - output_format (string, optional): png|jpeg|webp (GPT models only)
  - output_compression (integer 0–100, optional): for webp/jpeg
  - moderation (string, optional): auto|low (GPT models only)
  - save_to_workspace (boolean, optional): save to MCP workspace root, default: false
  - response_format (string, optional): markdown|json, default: markdown

Returns: Base64-encoded image(s) with metadata. If save_to_workspace=true, also returns file path.

Error cases: invalid model name, prompt too long, n>10, dall-e-3 with n>1, provider auth failure.`,
        inputSchema: ImageGenerateSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (params: unknown) => {
        return this.execute(params);
      },
    );
  }

  async execute(rawParams: unknown) {
    const parseResult = ImageGenerateSchema.safeParse(rawParams);
    if (!parseResult.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Validation error: ${parseResult.error.issues.map((i) => i.message).join('; ')}`,
          },
        ],
      };
    }

    const params = parseResult.data;

    try {
      let prompt = params.prompt;
      this.logger.log(`image_generate: model=${params.model} n=${params.n}`);

      const results = await this.provider.generate({
        prompt,
        model: params.model,
        n: params.n,
        size: params.size,
        quality: params.quality,
        background: params.background,
        output_format: params.output_format,
        output_compression: params.output_compression,
        moderation: params.moderation,
      });

      const text =
        params.response_format === ResponseFormat.JSON
          ? this.formatJson(results, params.model)
          : this.formatMarkdown(results, prompt);

      return {
        content: [{ type: 'text' as const, text }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`image_generate failed: ${message}`);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
      };
    }
  }

  private formatMarkdown(results: ImageResult[], prompt: string): string {
    const lines = [`# Generated Image(s)`, ``, `**Prompt:** ${prompt}`, ``];
    for (const [i, img] of results.entries()) {
      lines.push(`## Image ${i + 1}`);
      lines.push(`**Model:** ${img.model}`);
      if (img.revised_prompt) {
        lines.push(`**Revised prompt:** ${img.revised_prompt}`);
      }
      lines.push(`**Data:** data:image/png;base64,${img.b64_json}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  private formatJson(results: ImageResult[], model: string): string {
    return JSON.stringify(
      {
        model,
        count: results.length,
        images: results.map((img, i) => ({
          index: i,
          b64_json: img.b64_json,
          revised_prompt: img.revised_prompt,
          created: img.created,
        })),
      },
      null,
      2,
    );
  }
}
