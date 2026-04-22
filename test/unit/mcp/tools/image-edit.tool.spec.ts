import { Test, type TestingModule } from '@nestjs/testing';
import { ImageEditTool } from '../../../../src/mcp/tools/image-edit.tool';
import { PROVIDER_TOKEN } from '../../../../src/providers/provider.interface';
import type { IImageProvider, ImageResult } from '../../../../src/providers/provider.interface';
import { RootsService } from '../../../../src/mcp/features/roots.service';

const mockResult: ImageResult = {
  b64_json: 'ZWRpdGVkaW1hZ2U=',
  model: 'gpt-image-1',
  created: 1_700_000_000,
};

const VALID_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('ImageEditTool', () => {
  let tool: ImageEditTool;
  let mockProvider: jest.Mocked<Pick<IImageProvider, 'edit' | 'name'>>;

  beforeEach(async () => {
    mockProvider = { name: 'openai', edit: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageEditTool,
        { provide: PROVIDER_TOKEN, useValue: mockProvider },
        { provide: RootsService, useValue: { saveImageToWorkspace: jest.fn().mockResolvedValue(null), getRoots: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();
    tool = module.get(ImageEditTool);
  });

  describe('Input Validation', () => {
    it('should reject missing image', async () => {
      const result = await tool.execute({ prompt: 'add a hat', image: '' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/validation error/i);
    });

    it('should reject missing prompt', async () => {
      const result = await tool.execute({ image: VALID_B64, prompt: '' });
      expect(result.isError).toBe(true);
    });

    it('should accept valid params without mask', async () => {
      mockProvider.edit.mockResolvedValue([mockResult]);
      const result = await tool.execute({ image: VALID_B64, prompt: 'add a hat' });
      expect(result.isError).toBeUndefined();
    });

    it('should accept valid params with mask', async () => {
      mockProvider.edit.mockResolvedValue([mockResult]);
      const result = await tool.execute({ image: VALID_B64, mask: VALID_B64, prompt: 'add a hat' });
      expect(result.isError).toBeUndefined();
      expect(mockProvider.edit).toHaveBeenCalledWith(
        expect.objectContaining({ mask: VALID_B64 }),
      );
    });
  });

  describe('Successful Edit', () => {
    beforeEach(() => mockProvider.edit.mockResolvedValue([mockResult]));

    it('should return markdown with base64 data by default', async () => {
      const result = await tool.execute({ image: VALID_B64, prompt: 'add a hat' });
      expect(result.content[0].text).toContain(mockResult.b64_json);
      expect(result.content[0].text).toContain('# Edited Image');
    });

    it('should return JSON when response_format=json', async () => {
      const result = await tool.execute({ image: VALID_B64, prompt: 'add a hat', response_format: 'json' });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.images[0].b64_json).toBe(mockResult.b64_json);
    });

    it('should pass model through to provider', async () => {
      await tool.execute({ image: VALID_B64, prompt: 'add a hat', model: 'dall-e-2' });
      expect(mockProvider.edit).toHaveBeenCalledWith(expect.objectContaining({ model: 'dall-e-2' }));
    });
  });

  describe('Error Handling', () => {
    it('should return isError when provider throws', async () => {
      mockProvider.edit.mockRejectedValue(new Error('API error'));
      const result = await tool.execute({ image: VALID_B64, prompt: 'add a hat' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('API error');
    });
  });
});
