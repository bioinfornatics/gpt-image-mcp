import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AppConfig } from '../../config/app.config';

export interface ElicitationField {
  type: 'string' | 'number' | 'boolean';
  title?: string;
  description?: string;
  enum?: string[];
  default?: string | number | boolean;
}

export interface ElicitationRequest {
  message: string;
  requestedSchema: {
    type: 'object';
    properties: Record<string, ElicitationField>;
    required?: string[];
  };
}

export interface ElicitationResponse {
  action: 'accept' | 'decline' | 'cancel';
  content?: Record<string, unknown>;
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
   * NEVER requests passwords, API keys, or other secrets.
   */
  async requestImageParams(
    server: Server,
    currentParams: { hasQuality: boolean; hasSize: boolean; hasStyle: boolean },
  ): Promise<Record<string, unknown> | null> {
    if (!this.isEnabled) {
      this.logger.debug('Elicitation disabled, skipping');
      return null;
    }

    const properties: Record<string, ElicitationField> = {};

    if (!currentParams.hasQuality) {
      properties['quality'] = {
        type: 'string',
        title: 'Image Quality',
        description: 'The quality level for the generated image',
        enum: ['auto', 'high', 'medium', 'low'],
        default: 'auto',
      };
    }

    if (!currentParams.hasSize) {
      properties['size'] = {
        type: 'string',
        title: 'Image Size',
        description: 'The dimensions of the generated image',
        enum: ['auto', '1024x1024', '1536x1024', '1024x1536'],
        default: 'auto',
      };
    }

    if (Object.keys(properties).length === 0) {
      return null; // Nothing to elicit
    }

    try {
      // Note: elicitation/create is a client-initiated protocol feature
      // The server sends this request during a tool call
      const result = await (server as any).request(
        {
          method: 'elicitation/create',
          params: {
            message: 'Please refine your image generation preferences:',
            requestedSchema: {
              type: 'object',
              properties,
            },
          },
        },
        // ElicitationResultSchema — using any since SDK types may vary
        {} as any,
      );

      if (result?.action === 'accept' && result?.content) {
        return result.content as Record<string, unknown>;
      }
      return null;
    } catch (err) {
      // Client may not support elicitation — gracefully degrade
      this.logger.debug(`Elicitation not supported or failed: ${String(err)}`);
      return null;
    }
  }
}
