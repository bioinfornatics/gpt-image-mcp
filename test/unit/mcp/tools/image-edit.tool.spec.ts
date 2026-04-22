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
  let mockRoots: jest.Mocked<RootsService>;

  const mockServer = { request: jest.fn() };

  beforeEach(async () => {
    mockProvider = { name: 'openai', edit: jest.fn() };
    mockRoots = {
      saveImageToWorkspace: jest.fn().mockResolvedValue(null),
      getRoots: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<RootsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageEditTool,
        { provide: PROVIDER_TOKEN, useValue: mockProvider },
        { provide: RootsService, useValue: mockRoots },
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

    it('should use correct MIME type for output_format=jpeg in markdown', async () => {
      const result = await tool.execute({ image: VALID_B64, prompt: 'add a hat', output_format: 'jpeg' });
      expect(result.content[0].text).toContain('data:image/jpeg;base64,');
    });

    it('should use correct MIME type for output_format=webp in markdown', async () => {
      const result = await tool.execute({ image: VALID_B64, prompt: 'add a hat', output_format: 'webp' });
      expect(result.content[0].text).toContain('data:image/webp;base64,');
    });

    it('should default to png MIME type when output_format not set', async () => {
      const result = await tool.execute({ image: VALID_B64, prompt: 'add a hat' });
      expect(result.content[0].text).toContain('data:image/png;base64,');
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

  describe('save_to_workspace (H3)', () => {
    beforeEach(() => mockProvider.edit.mockResolvedValue([{ b64_json: 'ZWRpdA==', model: 'gpt-image-1', created: 0 }]));

    it('should call roots.saveImageToWorkspace when save_to_workspace=true and server provided', async () => {
      mockRoots.saveImageToWorkspace.mockResolvedValue('/workspace/generated/img.png');

      const result = await tool.execute(
        { image: VALID_B64, prompt: 'test', save_to_workspace: true },
        mockServer,
      );

      expect(mockRoots.saveImageToWorkspace).toHaveBeenCalledTimes(1);
      expect(result.content[0].text).toContain('Saved to');
    });

    it('should include saved path in markdown output', async () => {
      const savedPath = '/workspace/generated/img.png';
      mockRoots.saveImageToWorkspace.mockResolvedValue(savedPath);

      const result = await tool.execute(
        { image: VALID_B64, prompt: 'test', save_to_workspace: true },
        mockServer,
      );

      expect(result.content[0].text).toContain(savedPath);
    });

    it('should NOT call roots.saveImageToWorkspace when server not provided', async () => {
      await tool.execute({ image: VALID_B64, prompt: 'test', save_to_workspace: true });
      expect(mockRoots.saveImageToWorkspace).not.toHaveBeenCalled();
    });

    it('should NOT call roots.saveImageToWorkspace when save_to_workspace=false', async () => {
      await tool.execute({ image: VALID_B64, prompt: 'test', save_to_workspace: false }, mockServer);
      expect(mockRoots.saveImageToWorkspace).not.toHaveBeenCalled();
    });

    it('should not include Saved to in output when save returns null', async () => {
      mockRoots.saveImageToWorkspace.mockResolvedValue(null);

      const result = await tool.execute(
        { image: VALID_B64, prompt: 'test', save_to_workspace: true },
        mockServer,
      );

      expect(result.content[0].text).not.toContain('Saved to');
    });
  });

  describe('register() — server closure', () => {
    it('should pass the McpServer instance to execute() via closure', async () => {
      mockProvider.edit.mockResolvedValue([mockResult]);

      let capturedServer: unknown;
      const executeSpy = jest.spyOn(tool, 'execute').mockImplementation(async (_p, s) => {
        capturedServer = s;
        return { content: [{ type: 'text' as const, text: '' }] };
      });

      const mockMcpServer = {
        registerTool: jest.fn((_name: string, _meta: unknown, handler: (p: unknown) => unknown) => {
          return handler({ image: VALID_B64, prompt: 'test' });
        }),
      };

      tool.register(mockMcpServer as any);

      expect(capturedServer).toBe(mockMcpServer);
      executeSpy.mockRestore();
    });
  });
});
