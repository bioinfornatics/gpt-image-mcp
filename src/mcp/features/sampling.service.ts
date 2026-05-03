import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AppConfig } from '../../config/app.config';
import { sanitisePrompt, maskSecret } from '../../security/sanitise';

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
      // SDK v1.29: server.createMessage() is a typed method on Server (not McpServer).
      // No cast needed — server is correctly typed as Server from @mcp/sdk/server/index.js.
      const result = await server.createMessage({
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
      });

      if (result?.content?.type === 'text' && result.content.text) {
        const enhanced = String(result.content.text).trim();
        this.logger.debug(`Prompt enhanced: ${enhanced.substring(0, 80)}...`);
        // Re-sanitise: LLM output is untrusted — strip null bytes, enforce length
        try {
          return sanitisePrompt(enhanced, 32_000);
        } catch {
          this.logger.warn('Sampling response exceeded max length, falling back to original prompt');
          return originalPrompt;
        }
      }
      return originalPrompt;
    } catch (err) {
      this.logger.debug(`Sampling not available or failed: ${maskSecret(String(err))}`);
      return originalPrompt;
    }
  }
}
