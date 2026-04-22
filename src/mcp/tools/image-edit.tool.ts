import { Injectable, Inject, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PROVIDER_TOKEN } from '../../providers/provider.interface';
import type { IImageProvider, ImageResult } from '../../providers/provider.interface';
import { RootsService } from '../features/roots.service';
import { ImageEditSchema, ResponseFormat, PROMPT_MAX_LENGTH_GPT } from './schemas';
import { sanitisePrompt } from '../../security/sanitise';

@Injectable()
export class ImageEditTool {
  private readonly logger = new Logger(ImageEditTool.name);

  constructor(
    @Inject(PROVIDER_TOKEN) private readonly provider: IImageProvider,
    private readonly roots: RootsService,
  ) {}

  register(server: McpServer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).registerTool(
      'image_edit',
      {
        title: 'Edit Image',
        description: `Edit an existing image using an inpainting mask and a text prompt.

Args:
  - image (string, required): Base64-encoded source image (PNG recommended)
  - mask (string, optional): Base64-encoded mask (white=area to edit, black=keep)
  - prompt (string, required): Description of the desired edit
  - model (string, optional): Model to use, default: gpt-image-1
  - n (integer 1–10, optional): Number of edited images to generate, default: 1
  - size (string, optional): Output size, default: auto
  - quality (string, optional): Quality level, default: auto
  - output_format (string, optional): png|jpeg|webp
  - output_compression (integer 0–100, optional): For webp/jpeg
  - save_to_workspace (boolean, optional): Save output to workspace root
  - response_format (string, optional): markdown|json, default: markdown

Returns: Base64-encoded edited image(s).`,
        inputSchema: ImageEditSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async (params: unknown) => this.execute(params, server),
    );
  }

  async execute(rawParams: unknown, server?: unknown) {
    const parseResult = ImageEditSchema.safeParse(rawParams);
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
      let sanitisedPrompt: string;
      try {
        sanitisedPrompt = sanitisePrompt(params.prompt, PROMPT_MAX_LENGTH_GPT);
      } catch (sanitiseErr) {
        const msg = sanitiseErr instanceof Error ? sanitiseErr.message : String(sanitiseErr);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Input sanitisation error: ${msg}` }],
        };
      }
      this.logger.log(`image_edit: model=${params.model}`);
      const results = await this.provider.edit({
        image: params.image,
        mask: params.mask,
        prompt: sanitisedPrompt,
        model: params.model,
        n: params.n,
        size: params.size,
        quality: params.quality,
        output_format: params.output_format,
        output_compression: params.output_compression,
      });

      // M4: Roots — save to workspace if requested and server available
      const savedPaths: string[] = [];
      if (params.save_to_workspace && server) {
        for (const img of results) {
          const format = (params.output_format ?? 'png') as 'png' | 'jpeg' | 'webp';
          const saved = await this.roots.saveImageToWorkspace(server as never, img.b64_json, format);
          if (saved) savedPaths.push(saved);
        }
      }

      const outputFormat = params.output_format ?? 'png';
      const text =
        params.response_format === ResponseFormat.JSON
          ? JSON.stringify({ count: results.length, images: results }, null, 2)
          : this.formatMarkdown(results, params.prompt, savedPaths, outputFormat);

      return { content: [{ type: 'text' as const, text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
      };
    }
  }

  private formatMarkdown(
    results: ImageResult[],
    prompt: string,
    savedPaths: string[] = [],
    outputFormat = 'png',
  ): string {
    const lines = [`# Edited Image(s)`, ``, `**Prompt:** ${prompt}`, ``];
    for (const [i, img] of results.entries()) {
      lines.push(`## Image ${i + 1}`);
      lines.push(`**Model:** ${img.model}`);
      if (savedPaths[i]) {
        lines.push(`**Saved to:** ${savedPaths[i]}`);
      }
      lines.push(`**Data:** data:image/${outputFormat};base64,${img.b64_json}`);
      lines.push('');
    }
    return lines.join('\n');
  }
}
