import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AppConfig } from '../../config/app.config';

@Injectable()
export class SamplingService {
  private readonly logger = new Logger(SamplingService.name);

  constructor(private readonly configService: ConfigService) {}

  get isEnabled(): boolean {
    return this.configService.get<AppConfig['mcp']>('mcp')!.useSampling;
  }

  /**
   * Request the client LLM to enhance an image generation prompt.
   * Returns the enhanced prompt, or the original if sampling fails/unavailable.
   */
  async enhancePrompt(server: Server, originalPrompt: string, model: string): Promise<string> {
    if (!this.isEnabled) {
      return originalPrompt;
    }

    try {
      const result = await (server as any).request(
        {
          method: 'sampling/createMessage',
          params: {
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: [
                    `You are an expert at writing image generation prompts for ${model}.`,
                    `Enhance the following prompt to be more detailed, specific, and likely to produce`,
                    `a high-quality image. Return ONLY the enhanced prompt text, nothing else.`,
                    ``,
                    `Original prompt: "${originalPrompt}"`,
                  ].join('\n'),
                },
              },
            ],
            maxTokens: 300,
            systemPrompt:
              'You enhance image generation prompts. Return only the enhanced prompt, no explanation.',
          },
        },
        {} as any,
      );

      if (result?.content?.type === 'text' && result.content.text) {
        const enhanced = String(result.content.text).trim();
        this.logger.debug(`Prompt enhanced: ${enhanced.substring(0, 80)}...`);
        return enhanced;
      }
      return originalPrompt;
    } catch (err) {
      this.logger.debug(`Sampling not available or failed: ${String(err)}`);
      return originalPrompt;
    }
  }
}
