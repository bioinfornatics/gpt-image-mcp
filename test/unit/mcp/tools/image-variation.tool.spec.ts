import { Test, type TestingModule } from '@nestjs/testing';
import { ImageVariationTool } from '../../../../src/mcp/tools/image-variation.tool';
import { PROVIDER_TOKEN } from '../../../../src/providers/provider.interface';
import type { IImageProvider, ImageResult } from '../../../../src/providers/provider.interface';
import { RootsService } from '../../../../src/mcp/features/roots.service';

const mockResult: ImageResult = { b64_json: 'dmFyaWF0aW9u', model: 'dall-e-2', created: 0 };

const VALID_B64 = 'ZmFrZQ==';

describe('ImageVariationTool', () => {
  let tool: ImageVariationTool;
  let mockProvider: jest.Mocked<Pick<IImageProvider, 'variation' | 'name'>>;
  let mockRoots: jest.Mocked<RootsService>;

  const mockServer = { request: jest.fn() };

  const makeModule = async (providerName: 'openai' | 'azure') => {
    mockProvider = { name: providerName, variation: jest.fn() };
    mockRoots = {
      saveImageToWorkspace: jest.fn().mockResolvedValue(null),
      getRoots: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<RootsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageVariationTool,
        { provide: PROVIDER_TOKEN, useValue: mockProvider },
        { provide: RootsService, useValue: mockRoots },
      ],
    }).compile();
    tool = module.get(ImageVariationTool);
  };

  describe('with OpenAI provider', () => {
    beforeEach(() => makeModule('openai'));

    it('should return variation images on success', async () => {
      mockProvider.variation.mockResolvedValue([mockResult]);
      const result = await tool.execute({ image: VALID_B64 });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain(mockResult.b64_json);
    });

    it('should propagate provider errors', async () => {
      mockProvider.variation.mockRejectedValue(new Error('dalle2 error'));
      const result = await tool.execute({ image: VALID_B64 });
      expect(result.isError).toBe(true);
    });

    it('should use png MIME type in data URI', async () => {
      mockProvider.variation.mockResolvedValue([mockResult]);
      const result = await tool.execute({ image: VALID_B64 });
      expect(result.content[0].text).toContain('data:image/png;base64,');
    });
  });

  describe('with Azure provider', () => {
    beforeEach(() => makeModule('azure'));

    it('should return error for Azure provider (not supported)', async () => {
      const result = await tool.execute({ image: VALID_B64 });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/azure/i);
    });
  });

  describe('save_to_workspace (H3)', () => {
    beforeEach(async () => {
      await makeModule('openai');
      mockProvider.variation.mockResolvedValue([mockResult]);
    });

    it('should call roots.saveImageToWorkspace when save_to_workspace=true and server provided', async () => {
      mockRoots.saveImageToWorkspace.mockResolvedValue('/workspace/generated/var.png');

      const result = await tool.execute(
        { image: VALID_B64, save_to_workspace: true },
        mockServer,
      );

      expect(mockRoots.saveImageToWorkspace).toHaveBeenCalledTimes(1);
      expect(mockRoots.saveImageToWorkspace).toHaveBeenCalledWith(mockServer, mockResult.b64_json, 'png');
      expect(result.content[0].text).toContain('Saved to');
    });

    it('should include saved path in markdown output', async () => {
      const savedPath = '/workspace/generated/var.png';
      mockRoots.saveImageToWorkspace.mockResolvedValue(savedPath);

      const result = await tool.execute(
        { image: VALID_B64, save_to_workspace: true },
        mockServer,
      );

      expect(result.content[0].text).toContain(savedPath);
    });

    it('should NOT call roots.saveImageToWorkspace when server not provided', async () => {
      await tool.execute({ image: VALID_B64, save_to_workspace: true });
      expect(mockRoots.saveImageToWorkspace).not.toHaveBeenCalled();
    });

    it('should NOT call roots.saveImageToWorkspace when save_to_workspace=false', async () => {
      await tool.execute({ image: VALID_B64, save_to_workspace: false }, mockServer);
      expect(mockRoots.saveImageToWorkspace).not.toHaveBeenCalled();
    });

    it('should not include Saved to in output when save returns null', async () => {
      mockRoots.saveImageToWorkspace.mockResolvedValue(null);

      const result = await tool.execute(
        { image: VALID_B64, save_to_workspace: true },
        mockServer,
      );

      expect(result.content[0].text).not.toContain('Saved to');
    });
  });

  describe('register() — server closure', () => {
    beforeEach(() => makeModule('openai'));

    it('should pass the McpServer instance to execute() via closure', async () => {
      mockProvider.variation.mockResolvedValue([mockResult]);

      let capturedServer: unknown;
      const executeSpy = jest.spyOn(tool, 'execute').mockImplementation(async (_p, s) => {
        capturedServer = s;
        return { content: [{ type: 'text' as const, text: '' }] };
      });

      const mockMcpServer = {
        registerTool: jest.fn((_name: string, _meta: unknown, handler: (p: unknown) => unknown) => {
          return handler({ image: VALID_B64 });
        }),
      };

      tool.register(mockMcpServer as any);

      expect(capturedServer).toBe(mockMcpServer);
      executeSpy.mockRestore();
    });
  });
});
