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
 * Size options surfaced in the elicitation form, keyed by model family.
 *
 * gpt-image-2  : arbitrary resolution up to 4K — show the most useful fixed options.
 * gpt-image-1.x: fixed resolutions only — same set, no 4K options.
 * dall-e-2     : only valid for variations, never reaches elicitation.
 */
const SIZE_OPTIONS_GPT_IMAGE_2 = [
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x2048',
  '4096x4096',
] as const;

const SIZE_OPTIONS_GPT_IMAGE_1X = [
  'auto',
  '1024x1024',
  '1536x1024',
  '1024x1536',
] as const;

function sizeOptionsForModel(model: string): readonly string[] {
  return model === 'gpt-image-2' ? SIZE_OPTIONS_GPT_IMAGE_2 : SIZE_OPTIONS_GPT_IMAGE_1X;
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

    if (!params.hasQuality) {
      properties['quality'] = {
        type: 'string',
        title: 'Image Quality',
        description: 'The quality level for the generated image',
        enum: ['auto', 'high', 'medium', 'low'],
        default: 'auto',
      };
    }

    if (!params.hasSize) {
      properties['size'] = {
        type: 'string',
        title: 'Image Size',
        description: 'The dimensions of the generated image',
        enum: [...sizeOptionsForModel(params.model)],
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
        message: 'Please refine your image generation preferences:',
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
