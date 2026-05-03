import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AppConfig } from '../../config/app.config';
import { maskSecret } from '../../security/sanitise';

export interface ElicitationField {
  type: 'string' | 'number' | 'boolean';
  title?: string;
  description?: string;
  enum?: string[];
  default?: string | number | boolean;
}

export interface ElicitationResponse {
  action: 'accept' | 'decline' | 'cancel';
  content?: Record<string, unknown>;
}

/**
 * Size options for the elicitation form.
 * Must exactly match the values accepted by ImageGenerateSchema.size.
 * When arbitrary-resolution support lands (gpt-image-2 WxH validator),
 * this will be extended with a free-text "custom" option.
 */
const ELICITATION_SIZE_OPTIONS = [
  'auto',
  '1024x1024',   // Square · 1:1 — social, avatar, album art
  '1536x1024',   // Landscape · 3:2 — scenes, banners, desktop
  '1024x1536',   // Portrait · 2:3 — phone screens, posters, stories
] as const;

function sizeOptionsForModel(_model: string): readonly string[] {
  // All current gpt-image-* models share the same fixed sizes.
  // When gpt-image-2 arbitrary resolution lands, add model-branching here.
  return ELICITATION_SIZE_OPTIONS;
}

@Injectable()
export class ElicitationService {
  private readonly logger = new Logger(ElicitationService.name);

  constructor(private readonly configService: ConfigService) {}

  get isEnabled(): boolean {
    return this.configService.get<AppConfig['mcp']>('mcp')!.useElicitation;
  }

  /**
   * Request elicitation from the client for missing image generation parameters.
   *
   * Fires when ALL of the following are true:
   *   1. USE_ELICITATION=true (env, default true)
   *   2. A connected MCP Server is available
   *   3. skip_elicitation was NOT set to true in the tool call
   *   4. quality and/or size were not explicitly set to a non-auto value by the caller
   *
   * NEVER requests passwords, API keys, or other secrets.
   *
   * @param server    Inner SDK Server instance (not McpServer wrapper)
   * @param params    What the caller has already provided
   */
  async requestImageParams(
    server: Server,
    params: {
      hasQuality: boolean;  // true when quality was set to something other than 'auto'
      hasSize: boolean;     // true when size was set to something other than 'auto'
      model: string;        // used to show model-appropriate size options
    },
  ): Promise<Record<string, unknown> | null> {
    if (!this.isEnabled) {
      this.logger.debug('Elicitation disabled, skipping');
      return null;
    }

    const properties: Record<string, ElicitationField> = {};

    if (!params.hasSize) {
      properties['size'] = {
        type: 'string',
        title: 'Image Size',
        description:
          'Choose the shape for your image. Square for social/avatars, Landscape for scenes/banners, Portrait for phone screens/posters.',
        enum: [...sizeOptionsForModel(params.model)],
        default: 'auto',
      };
    }

    if (!params.hasQuality) {
      properties['quality'] = {
        type: 'string',
        title: 'Image Quality',
        description:
          'Higher quality takes longer and costs more. Use "low" for fast drafts and ideation; use "high" for final output, dense text, or close-up faces.',
        enum: ['auto', 'high', 'medium', 'low'],
        default: 'auto',
      };
    }

    if (Object.keys(properties).length === 0) {
      return null; // Nothing to elicit — caller already specified everything
    }

    try {
      // SDK v1.29: server.elicitInput() is a typed method on Server (not McpServer).
      // No cast needed — server is correctly typed as Server from @mcp/sdk/server/index.js.
      const result = await server.elicitInput({
        message:
          'A few quick settings for your image — all have smart defaults, just change what matters to you.',
        requestedSchema: { type: 'object' as const, properties },
      });

      if (result?.action === 'accept' && result?.content) {
        return result.content as Record<string, unknown>;
      }
      return null;
    } catch (err) {
      // Client may not support elicitation — gracefully degrade
      this.logger.debug(`Elicitation not supported or failed: ${maskSecret(String(err))}`);
      return null;
    }
  }
}
