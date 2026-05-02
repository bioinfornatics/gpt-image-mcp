import { Injectable, Inject, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { PROVIDER_TOKEN } from '../../providers/provider.interface';
import type { IImageProvider, ImageResult } from '../../providers/provider.interface';
import { ElicitationService } from '../features/elicitation.service';
import { SamplingService } from '../features/sampling.service';
import { RootsService } from '../features/roots.service';
import { ImageGenerateSchema, ResponseFormat, PROMPT_MAX_LENGTH_GPT } from './schemas';
import { sanitisePrompt, maskSecret } from '../../security/sanitise';

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

Supported models: gpt-image-2 (default/recommended), gpt-image-1.5, gpt-image-1-mini, gpt-image-1. dall-e-2 is available for variations only; dall-e-3 was retired 2026-03-04.

Args:
  - prompt (string, required): Text description, max 32 000 chars for GPT models
  - model (string, optional): Model identifier, default: gpt-image-2
  - n (integer 1–10, optional): Number of images, default: 1
  - size (string, optional): auto|1024x1024|1536x1024|1024x1536|..., default: auto
  - quality (string, optional): auto|high|medium|low|hd|standard, default: auto
  - background (string, optional): auto|transparent|opaque (GPT models only)
  - output_format (string, optional): png|jpeg|webp (GPT models only)
  - output_compression (integer 0–100, optional): for webp/jpeg
  - moderation (string, optional): auto|low (GPT models only)
  - save_to_workspace (boolean, optional): save to MCP workspace root, default: false
  - response_format (string, optional): markdown|json, default: markdown

Returns: Base64-encoded image(s) with metadata. If save_to_workspace=true, also returns file path.

Error cases: invalid model name, prompt too long, n>10, provider auth failure.`,
        inputSchema: ImageGenerateSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      // Pass the inner Server (not McpServer) so feature services can call
      // elicitInput() / createMessage() / listRoots() which live on Server, not McpServer.
      async (params: unknown) => this.execute(params, server.server),
    );
  }

  async execute(rawParams: unknown, server?: Server) {
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
      // US-018: Sanitise prompt (strips null bytes, trims, enforces max length)
      let prompt: string;
      try {
        prompt = sanitisePrompt(params.prompt, PROMPT_MAX_LENGTH_GPT);
      } catch (sanitiseErr) {
        const msg = sanitiseErr instanceof Error ? sanitiseErr.message : String(sanitiseErr);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `Input error: ${msg}` }],
        };
      }

      // Guard: if sanitised prompt is empty, reject
      if (!prompt) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Validation error: prompt is required and cannot be empty' }],
        };
      }

      this.logger.log(`image_generate: model=${params.model} n=${params.n}`);

      // M4: Sampling — enhance prompt via client LLM if server available
      if (server) {
        prompt = await this.sampling.enhancePrompt(server, prompt, params.model);
      }

      // M4: Elicitation — request missing params from user if client supports it
      if (server) {
        const elicited = await this.elicitation.requestImageParams(server, {
          hasQuality: params.quality !== 'auto' && params.quality !== undefined,
          hasSize: params.size !== 'auto' && params.size !== undefined,
          hasStyle: false,
        });
        if (elicited) {
          if (typeof elicited['quality'] === 'string') {
            params.quality = elicited['quality'] as typeof params.quality;
          }
          if (typeof elicited['size'] === 'string') {
            params.size = elicited['size'] as typeof params.size;
          }
        }
      }

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

      // M4: Roots — save to workspace if requested and server available
      const savedPaths: string[] = [];
      if (params.save_to_workspace && server) {
        for (const img of results) {
          const format = (params.output_format ?? 'png') as 'png' | 'jpeg' | 'webp';
          const path = await this.roots.saveImageToWorkspace(server, img.b64_json, format);
          if (path) savedPaths.push(path);
        }
      }

      const outputFormat = params.output_format ?? 'png';
      const text =
        params.response_format === ResponseFormat.JSON
          ? this.formatJson(results, params.model, savedPaths)
          : this.formatMarkdown(results, prompt, savedPaths, outputFormat);

      return {
        content: [{ type: 'text' as const, text }],
      };
    } catch (err) {
      const message = maskSecret(err instanceof Error ? err.message : String(err));
      this.logger.error(`image_generate failed: ${message}`);
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
    const lines = [`# Generated Image(s)`, ``, `**Prompt:** ${prompt}`, ``];
    for (const [i, img] of results.entries()) {
      lines.push(`## Image ${i + 1}`);
      lines.push(`**Model:** ${img.model}`);
      if (img.revised_prompt) {
        lines.push(`**Revised prompt:** ${img.revised_prompt}`);
      }
      if (savedPaths[i]) {
        lines.push(`**Saved to:** ${savedPaths[i]}`);
      }
      lines.push(`**Data:** data:image/${outputFormat};base64,${img.b64_json}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  private formatJson(results: ImageResult[], model: string, savedPaths: string[] = []): string {
    return JSON.stringify(
      {
        model,
        count: results.length,
        images: results.map((img, i) => ({
          index: i,
          b64_json: img.b64_json,
          revised_prompt: img.revised_prompt,
          created: img.created,
          ...(savedPaths[i] ? { saved_to: savedPaths[i] } : {}),
        })),
      },
      null,
      2,
    );
  }
}
