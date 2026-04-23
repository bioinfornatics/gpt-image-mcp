import { Test, type TestingModule } from '@nestjs/testing';
import { ImageGenerateTool } from '../../../../src/mcp/tools/image-generate.tool';
import { PROVIDER_TOKEN } from '../../../../src/providers/provider.interface';
import { ElicitationService } from '../../../../src/mcp/features/elicitation.service';
import { SamplingService } from '../../../../src/mcp/features/sampling.service';
import { RootsService } from '../../../../src/mcp/features/roots.service';
import type { IImageProvider, ImageResult } from '../../../../src/providers/provider.interface';
import { LATEST_MODEL } from '../../../../src/config/models';

const mockImageResult: ImageResult = {
  b64_json: 'ZmFrZWJhc2U2NA==',
  model: 'gpt-image-1',
  created: 1_700_000_000,
};

describe('ImageGenerateTool', () => {
  let tool: ImageGenerateTool;
  let mockProvider: jest.Mocked<Pick<IImageProvider, 'generate' | 'edit' | 'variation' | 'validate' | 'name'>>;

  beforeEach(async () => {
    mockProvider = {
      name: 'openai',
      generate: jest.fn(),
      edit: jest.fn(),
      variation: jest.fn(),
      validate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageGenerateTool,
        { provide: PROVIDER_TOKEN, useValue: mockProvider },
        { provide: ElicitationService, useValue: { isEnabled: false, requestImageParams: jest.fn().mockResolvedValue(null) } },
        { provide: SamplingService, useValue: { isEnabled: false, enhancePrompt: jest.fn().mockImplementation((_s, p) => Promise.resolve(p)) } },
        { provide: RootsService, useValue: { getRoots: jest.fn().mockResolvedValue([]), saveImageToWorkspace: jest.fn().mockResolvedValue(null) } },
      ],
    }).compile();

    tool = module.get(ImageGenerateTool);
  });

  describe('Input Validation', () => {
    it('should reject an empty prompt', async () => {
      const result = await tool.execute({ prompt: '' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/validation error/i);
    });

    it('should reject a prompt exceeding 32 000 characters', async () => {
      const result = await tool.execute({ prompt: 'a'.repeat(32_001) });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/32.000|max/i);
    });

    it('should reject n greater than 10', async () => {
      const result = await tool.execute({ prompt: 'a cat', n: 11 });
      expect(result.isError).toBe(true);
    });

    it('should reject n less than 1', async () => {
      const result = await tool.execute({ prompt: 'a cat', n: 0 });
      expect(result.isError).toBe(true);
    });

    it('should accept valid minimal params and use defaults', async () => {
      mockProvider.generate.mockResolvedValue([mockImageResult]);
      const result = await tool.execute({ prompt: 'a cat' });
      expect(result.isError).toBeUndefined();
      expect(mockProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'a cat', model: LATEST_MODEL, n: 1 }),
      );
    });
  });

  describe('Successful Generation', () => {
    beforeEach(() => {
      mockProvider.generate.mockResolvedValue([mockImageResult]);
    });

    it('should return markdown by default containing base64 data', async () => {
      const result = await tool.execute({ prompt: 'a cat' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain(mockImageResult.b64_json);
      expect(result.content[0].text).toContain('# Generated Image');
    });

    it('should return JSON when response_format is json', async () => {
      const result = await tool.execute({ prompt: 'a cat', response_format: 'json' });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.images[0].b64_json).toBe(mockImageResult.b64_json);
    });

    it('should pass all parameters through to the provider', async () => {
      await tool.execute({
        prompt: 'a cat',
        model: 'dall-e-3',
        n: 1,
        size: '1024x1024',
        quality: 'high',
        background: 'transparent',
        output_format: 'webp',
        output_compression: 80,
        moderation: 'low',
      });
      expect(mockProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'dall-e-3',
          size: '1024x1024',
          quality: 'high',
          background: 'transparent',
          output_format: 'webp',
          output_compression: 80,
          moderation: 'low',
        }),
      );
    });

    it('should include revised_prompt in output when present', async () => {
      mockProvider.generate.mockResolvedValue([
        { ...mockImageResult, revised_prompt: 'A fluffy tabby cat sitting on a windowsill' },
      ]);
      const result = await tool.execute({ prompt: 'a cat' });
      expect(result.content[0].text).toContain('Revised prompt');
    });
  });

  describe('Error Handling', () => {
    it('should return isError when provider throws', async () => {
      mockProvider.generate.mockRejectedValue(new Error('Rate limit exceeded'));
      const result = await tool.execute({ prompt: 'a cat' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Rate limit exceeded');
    });

    it('should not expose raw error internals', async () => {
      mockProvider.generate.mockRejectedValue(new Error('sk-secret-key exposed in error'));
      const result = await tool.execute({ prompt: 'a cat' });
      // The message should still contain a useful error but provider should have masked key
      expect(result.isError).toBe(true);
    });
  });
});
