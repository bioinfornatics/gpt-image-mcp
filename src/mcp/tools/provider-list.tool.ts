import { Injectable, Inject, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PROVIDER_TOKEN } from '../../providers/provider.interface';
import type { IImageProvider } from '../../providers/provider.interface';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/app.config';

@Injectable()
export class ProviderListTool {
  private readonly logger = new Logger(ProviderListTool.name);

  constructor(
    @Inject(PROVIDER_TOKEN) private readonly provider: IImageProvider,
    private readonly configService: ConfigService,
  ) {}

  register(server: McpServer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).registerTool(
      'provider_list',
      {
        title: 'List Providers',
        description: `List all configured image generation providers and their status.

Returns: List of providers with name, configuration status, and available models.
Use provider_validate to test connectivity before generating images.`,
        inputSchema: z.object({}),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async () => this.execute(),
    );
  }

  async execute() {
    const defaultModel = this.configService.get<AppConfig['defaults']>('defaults')!.model;
    const providerName = this.provider.name;

    const modelsByProvider: Record<string, string[]> = {
      openai: ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-1-mini', 'dall-e-3', 'dall-e-2'],
      azure: ['gpt-image-1', 'gpt-image-1.5', 'gpt-image-2 (limited access)', 'dall-e-3'],
      together: [
        'black-forest-labs/FLUX.1-schnell-Free',
        'black-forest-labs/FLUX.1-schnell',
        'black-forest-labs/FLUX.1-dev',
        'black-forest-labs/FLUX.1.1-pro',
      ],
      custom: this.configService.get<AppConfig['custom']>('custom')?.models ?? ['custom'],
    };

    const output = {
      configured_provider: providerName,
      default_model: defaultModel,
      providers: [
        {
          name: providerName,
          configured: true,
          available_models: modelsByProvider[providerName] ?? [],
          status: 'configured',
        },
      ],
    };

    const text = [
      `# Configured Providers`,
      ``,
      `**Active Provider:** ${providerName}`,
      `**Default Model:** ${defaultModel}`,
      ``,
      `## ${providerName}`,
      `- Status: configured`,
      `- Available models: ${(modelsByProvider[providerName] ?? []).join(', ')}`,
      ...(providerName === 'azure' ? [
        ``,
        `> ⚠️ **gpt-image-2** requires explicit access approval via the Azure portal.`,
        `> A 403 error means your subscription does not have access yet.`,
      ] : []),
      ...(providerName === 'together' ? [
        ``,
        `> ℹ️ **Together AI**: FLUX models only. No image_edit or image_variation support.`,
        `> Free tier: FLUX.1-schnell-Free (rate limited). Sign up at together.ai`,
      ] : []),
      ...(providerName === 'custom' ? [
        ``,
        `> ℹ️ **Custom endpoint**: Pointing at ${this.configService.get<AppConfig['custom']>('custom')?.baseUrl ?? 'unknown'}`,
        `> Compatibility depends on your endpoint's OpenAI API support.`,
      ] : []),
      ``,
      `Run \`provider_validate\` to test connectivity.`,
    ].join('\n');

    return {
      content: [{ type: 'text' as const, text }],
      structuredContent: output,
    };
  }
}
