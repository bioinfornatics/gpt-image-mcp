import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProviderListTool } from '../../../../src/mcp/tools/provider-list.tool';
import { PROVIDER_TOKEN } from '../../../../src/providers/provider.interface';
import type { IImageProvider } from '../../../../src/providers/provider.interface';

describe('ProviderListTool', () => {
  let tool: ProviderListTool;

  const makeModule = async (providerName: 'openai' | 'azure') => {
    const mockProvider: Partial<IImageProvider> = { name: providerName };
    const module = await Test.createTestingModule({
      providers: [
        ProviderListTool,
        { provide: PROVIDER_TOKEN, useValue: mockProvider },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'defaults') return { model: 'gpt-image-1' };
              return undefined;
            },
          },
        },
      ],
    }).compile();
    tool = module.get(ProviderListTool);
  };

  describe('with OpenAI provider', () => {
    beforeEach(() => makeModule('openai'));

    it('should return markdown listing openai as active provider', async () => {
      const result = await tool.execute();
      expect(result.content[0].text).toContain('openai');
      expect(result.content[0].text).toContain('gpt-image-1');
    });

    it('should include structuredContent with configured_provider', async () => {
      const result = await tool.execute();
      expect((result as any).structuredContent.configured_provider).toBe('openai');
    });

    it('should list expected OpenAI models', async () => {
      const result = await tool.execute();
      expect(result.content[0].text).toContain('dall-e-2');
      expect(result.content[0].text).not.toContain('dall-e-3'); // retired 2026-03-04
    });
  });

  describe('with Azure provider', () => {
    beforeEach(() => makeModule('azure'));

    it('should return azure as active provider', async () => {
      const result = await tool.execute();
      expect(result.content[0].text).toContain('azure');
    });

    it('should list azure-specific models including gpt-image-2', async () => {
      const result = await tool.execute();
      expect(result.content[0].text).toContain('gpt-image-2');
    });
  });
});
