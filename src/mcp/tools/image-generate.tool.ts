import { Injectable, Inject, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/server';
import type { Server } from '@modelcontextprotocol/server';
import { PROVIDER_TOKEN } from '../../providers/provider.interface';
import { ImageProviderError } from '../../providers/provider.interface';
import type { IImageProvider, ImageResult } from '../../providers/provider.interface';
import { ElicitationService } from '../features/elicitation.service';
import { SamplingService } from '../features/sampling.service';
import { RootsService } from '../features/roots.service';
import { ImageStorageService, pathToFileUri } from '../features/image-storage.service';
import { ImageGenerateSchema, ResponseFormat, PROMPT_MAX_LENGTH_GPT, resolveModeration, isExperimentalResolution } from './schemas';
import { sanitisePrompt, maskSecret } from '../../security/sanitise';
import { LATEST_MODEL } from '../../config/models';

@Injectable()
export class ImageGenerateTool {
  private readonly logger = new Logger(ImageGenerateTool.name);

  constructor(
    @Inject(PROVIDER_TOKEN) private readonly provider: IImageProvider,
    private readonly elicitation: ElicitationService,
    private readonly sampling: SamplingService,
    private readonly roots: RootsService,
    private readonly storage: ImageStorageService,
  ) {}

  register(server: McpServer) {
    const configuredModel = this.provider.configuredModel;
    const defaultModel = this.provider.defaultModel ?? configuredModel ?? LATEST_MODEL;
    const availableModels = this.provider.availableModels;
    const modelContract = availableModels?.length
      ? `Default model: ${defaultModel}. Selectable deployed models: ${availableModels.join(', ')}. Omit model to use ${defaultModel}.`
      : configuredModel
        ? `Active configured model/deployment: ${configuredModel}. This server uses that fixed deployment; omit model (recommended) or pass exactly ${configuredModel}.`
        : 'Supported models: gpt-image-2 (default/recommended), gpt-image-1.5, gpt-image-1-mini, gpt-image-1. dall-e-2 is available for variations only; dall-e-3 was retired 2026-03-04.';
    const parameterContract = defaultModel.toLowerCase() === 'mai-image-2.5'
      ? 'MAI-Image-2.5 constraints: quality is not supported (omit it or use auto); size defaults to 1024x1024 and must have both edges >= 768 with at most 1,048,576 total pixels; output is PNG.'
      : 'GPT image constraints apply according to the selected model.';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).registerTool(
      'image_generate',
      {
        title: 'Generate Image',
        description: `Generate one or more images using the active configured image provider.

${modelContract}
${parameterContract}

Args:
  - prompt (string, required): Text description, max 32 000 chars for GPT models
  - model (string, optional): ${availableModels?.length ? `omit for ${defaultModel}; selectable: ${availableModels.join(', ')}` : configuredModel ? `fixed configured deployment; omit model or use ${configuredModel}` : `Model identifier, default: ${defaultModel}`}
  - n (integer 1–10, optional): Number of images, default: 1
  - size (string, optional): auto|1024x1024|1536x1024|1024x1536|..., default: auto
  - quality (string, optional): ${availableModels?.length ? 'model-dependent; MAI: omit/use auto; GPT: auto|high|medium|low' : configuredModel?.toLowerCase() === 'mai-image-2.5' ? 'not supported; omit or use auto' : 'auto|high|medium|low, default: auto'}
  - background (string, optional): auto|transparent|opaque (GPT models only)
  - output_format (string, optional): png|jpeg|webp (GPT models only)
  - output_compression (integer 0–100, optional): for webp/jpeg
  - moderation (string, optional): auto|low (GPT models only)
  - save_to_workspace (boolean, optional): save to MCP workspace root, default: false
  - skip_elicitation (boolean, optional): suppress interactive quality/size form, default: false
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
    const configuredModel = this.provider.configuredModel;
    const defaultModel = this.provider.defaultModel ?? configuredModel ?? LATEST_MODEL;
    const availableModels = this.provider.availableModels;
    const rawObject = rawParams && typeof rawParams === 'object'
      ? rawParams as Record<string, unknown>
      : undefined;
    const requestedModel = typeof rawObject?.['model'] === 'string'
      ? rawObject['model'].trim()
      : undefined;
    if (!availableModels?.length && configuredModel && requestedModel && requestedModel.toLowerCase() !== configuredModel.toLowerCase()) {
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: `Validation error: requested model "${requestedModel}" cannot be used because the configured deployment is "${configuredModel}". Omit "model" to use the configured deployment, or pass "${configuredModel}" exactly.`,
        }],
      };
    }
    const effectiveRawParams = rawObject && !requestedModel
      ? { ...rawObject, model: defaultModel }
      : rawParams;
    const parseResult = ImageGenerateSchema.safeParse(effectiveRawParams);
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

    const params = { ...parseResult.data, model: parseResult.data.model ?? defaultModel };

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

      // M4: Elicitation — request missing params from user BEFORE sampling.
      // Ordering rationale: elicitation determines quality/size intent first so that
      // the sampling step can incorporate those choices into the enhanced prompt.
      // skip_elicitation=true lets automated callers bypass the interactive form.
      if (server && !params.skip_elicitation) {
        const elicited = await this.elicitation.requestImageParams(server, {
          hasQuality: params.quality !== 'auto' && params.quality !== undefined,
          hasSize: params.size !== 'auto' && params.size !== undefined,
          model: params.model,
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

      // M4: Sampling — enhance prompt via client LLM AFTER elicitation.
      // Quality/size context is now resolved, so the LLM can produce a
      // prompt optimised for the actual output dimensions and fidelity.
      if (server) {
        prompt = await this.sampling.enhancePrompt(server, prompt, {
          model:          params.model,
          quality:        params.quality,
          size:           params.size,
          output_format:  params.output_format,
          background:     params.background,
          n:              params.n,
        });
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
        moderation: resolveModeration(params.moderation),
      });

      const savedPaths = await Promise.all(
        results.map((img) => this.storage.saveImage(img.b64_json, img.format)),
      );

      const workspacePaths: string[] = [];
      if (params.save_to_workspace && server) {
        for (const img of results) {
          const saved = await this.roots.saveImageToWorkspace(server, img.b64_json, img.format);
          if (saved) workspacePaths.push(saved);
        }
      }

      const experimental = isExperimentalResolution(params.size);
      const text = params.response_format === ResponseFormat.JSON
        ? this.formatJson(results, params.model, savedPaths, workspacePaths, experimental)
        : this.formatMarkdown(results, prompt, savedPaths, workspacePaths, experimental);
      return {
        content: [
          { type: 'text' as const, text },
          ...results.flatMap((img, i) => [
            { type: 'image' as const, data: img.b64_json, mimeType: img.mimeType },
            {
              type: 'resource_link' as const,
              uri: pathToFileUri(savedPaths[i]),
              name: savedPaths[i].split(/[\\/]/).pop() ?? `image-${i + 1}.${img.format}`,
              description: 'Persisted generated image',
              mimeType: img.mimeType,
            },
          ]),
        ],
      };
    } catch (err) {
      const message = maskSecret(err instanceof Error ? err.message : String(err));
      this.logger.error(`image_generate failed: ${message}`);
      if (err instanceof ImageProviderError) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `[${err.code}] ${message}` }],
          structuredContent: {
            error: {
              code: err.code,
              provider: err.provider,
              model: err.model,
              retryable: err.retryable,
              stage: err.stage,
              image_created: false,
              ...(err.status !== undefined ? { http_status: err.status } : {}),
              ...(err.providerCode ? { provider_code: err.providerCode } : {}),
              ...(err.label ? { provider_label: err.label } : {}),
              ...(err.requestId ? { request_id: err.requestId } : {}),
            },
          },
        };
      }
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Error: ${message}` }],
      };
    }
  }

  private formatMarkdown(
    results: ImageResult[],
    prompt: string,
    savedPaths: string[],
    workspacePaths: string[] = [],
    experimental = false,
  ): string {
    const lines = ['# Generated Image(s)', '', `**Prompt:** ${prompt}`, ''];
    if (experimental) {
      lines.push(
        '> ⚠️ **Experimental resolution:** requested size exceeds 2560×1440. ' +
        'gpt-image-2 output quality/reliability is more variable above this boundary.',
        '',
      );
    }
    for (const [i, img] of results.entries()) {
      lines.push(`## Image ${i + 1}`, `**Model:** ${img.model}`);
      if (img.revised_prompt) lines.push(`**Revised prompt:** ${img.revised_prompt}`);
      lines.push(`**Saved to:** ${savedPaths[i]}`);
      if (workspacePaths[i]) lines.push(`**Workspace copy:** ${workspacePaths[i]}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  private formatJson(
    results: ImageResult[],
    model: string,
    savedPaths: string[],
    workspacePaths: string[] = [],
    experimental = false,
  ): string {
    return JSON.stringify({
      model: results[0]?.model ?? model,
      count: results.length,
      ...(experimental ? {
        warning: 'Experimental resolution: requested size exceeds 2560×1440. ' +
          'gpt-image-2 output quality/reliability is more variable above this boundary.',
      } : {}),
      images: results.map((img, i) => ({
        index: i,
        saved_to: savedPaths[i],
        file_uri: pathToFileUri(savedPaths[i]),
        revised_prompt: img.revised_prompt,
        created: img.created,
        ...(workspacePaths[i] ? { workspace_copy: workspacePaths[i] } : {}),
      })),
    }, null, 2);
  }

}
