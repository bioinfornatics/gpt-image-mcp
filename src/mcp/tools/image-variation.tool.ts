import { Injectable, Inject, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PROVIDER_TOKEN } from '../../providers/provider.interface';
import type { IImageProvider, ImageResult } from '../../providers/provider.interface';
import { ImageVariationSchema, ResponseFormat } from './schemas';

@Injectable()
export class ImageVariationTool {
  private readonly logger = new Logger(ImageVariationTool.name);

  constructor(@Inject(PROVIDER_TOKEN) private readonly provider: IImageProvider) {}

  register(server: McpServer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).registerTool(
      'image_variation',
      {
        title: 'Create Image Variation',
        description: `Create a variation of an existing image. Only supported with dall-e-2.

Args:
  - image (string, required): Base64-encoded square PNG image
  - n (integer 1–10, optional): Number of variations, default: 1
  - size (string, optional): 256x256|512x512|1024x1024, default: 1024x1024
  - save_to_workspace (boolean, optional): Save to workspace root
  - response_format (string, optional): markdown|json, default: markdown

Returns: Base64-encoded variation image(s).
Note: Use dall-e-2 as model. Other models will return an error.`,
        inputSchema: ImageVariationSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (params: unknown) => this.execute(params),
    );
  }

  async execute(rawParams: unknown) {
    const parseResult = ImageVariationSchema.safeParse(rawParams);
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

    // Warn if provider is Azure (doesn't support variation)
    if (this.provider.name === 'azure') {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: 'Error: image_variation is not supported by Azure OpenAI. Use image_generate instead.',
          },
        ],
      };
    }

    try {
      this.logger.log(`image_variation: n=${params.n}`);
      const results = await this.provider.variation({
        image: params.image,
        n: params.n,
        size: params.size,
      });

      const text =
        params.response_format === ResponseFormat.JSON
          ? JSON.stringify({ count: results.length, images: results }, null, 2)
          : this.formatMarkdown(results);

      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
      };
    }
  }

  private formatMarkdown(results: ImageResult[]): string {
    const lines = [`# Image Variation(s)`, ``];
    for (const [i, img] of results.entries()) {
      lines.push(`## Variation ${i + 1}`);
      lines.push(`**Data:** data:image/png;base64,${img.b64_json}`);
      lines.push('');
    }
    return lines.join('\n');
  }
}
