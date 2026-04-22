import { Test } from '@nestjs/testing';
import { ImageVariationTool } from '../../../../src/mcp/tools/image-variation.tool';
import { PROVIDER_TOKEN } from '../../../../src/providers/provider.interface';
import type { IImageProvider, ImageResult } from '../../../../src/providers/provider.interface';

const mockResult: ImageResult = { b64_json: 'dmFyaWF0aW9u', model: 'dall-e-2', created: 0 };

describe('ImageVariationTool', () => {
  let tool: ImageVariationTool;
  let mockProvider: jest.Mocked<Pick<IImageProvider, 'variation' | 'name'>>;

  const makeModule = async (providerName: 'openai' | 'azure') => {
    mockProvider = { name: providerName, variation: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        ImageVariationTool,
        { provide: PROVIDER_TOKEN, useValue: mockProvider },
      ],
    }).compile();
    tool = module.get(ImageVariationTool);
  };

  describe('with OpenAI provider', () => {
    beforeEach(() => makeModule('openai'));

    it('should return variation images on success', async () => {
      mockProvider.variation.mockResolvedValue([mockResult]);
      const result = await tool.execute({ image: 'ZmFrZQ==' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain(mockResult.b64_json);
    });

    it('should propagate provider errors', async () => {
      mockProvider.variation.mockRejectedValue(new Error('dalle2 error'));
      const result = await tool.execute({ image: 'ZmFrZQ==' });
      expect(result.isError).toBe(true);
    });
  });

  describe('with Azure provider', () => {
    beforeEach(() => makeModule('azure'));

    it('should return error for Azure provider (not supported)', async () => {
      const result = await tool.execute({ image: 'ZmFrZQ==' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/azure/i);
    });
  });
});
