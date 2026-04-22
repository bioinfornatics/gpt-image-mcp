import { Injectable, Inject, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PROVIDER_TOKEN } from '../../providers/provider.interface';
import type { IImageProvider } from '../../providers/provider.interface';
import { ProviderValidateSchema } from './schemas';

@Injectable()
export class ProviderValidateTool {
  private readonly logger = new Logger(ProviderValidateTool.name);

  constructor(@Inject(PROVIDER_TOKEN) private readonly provider: IImageProvider) {}

  register(server: McpServer) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).registerTool(
      'provider_validate',
      {
        title: 'Validate Provider',
        description: `Validate a provider's configuration and test connectivity without generating an image.

Args:
  - provider (string, required): "openai" or "azure"

Returns: Validation result with status and any error details.
Use this before generating images to confirm your credentials are correct.`,
        inputSchema: ProviderValidateSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async (params: unknown) => this.execute(params),
    );
  }

  async execute(rawParams: unknown) {
    const parseResult = ProviderValidateSchema.safeParse(rawParams);
    if (!parseResult.success) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: 'Invalid parameters: provider must be "openai" or "azure"' }],
      };
    }

    const { provider: requestedProvider } = parseResult.data;

    if (requestedProvider !== this.provider.name) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Provider "${requestedProvider}" is not configured. Active provider is "${this.provider.name}".`,
          },
        ],
      };
    }

    this.logger.log(`Validating provider: ${requestedProvider}`);
    const result = await this.provider.validate();

    const text = result.valid
      ? `✅ Provider "${result.provider}" is valid and reachable.`
      : `❌ Provider "${result.provider}" validation failed: ${result.error}`;

    return {
      content: [{ type: 'text' as const, text }],
      structuredContent: result,
    };
  }
}
