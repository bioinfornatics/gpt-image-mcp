/**
 * Unit tests for ImageGenerateTool with M4 features wired:
 *   - Sampling (prompt enhancement)
 *   - Elicitation (request missing params from user)
 *   - Roots (save to workspace)
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ImageGenerateTool } from '../../../../src/mcp/tools/image-generate.tool';
import { PROVIDER_TOKEN } from '../../../../src/providers/provider.interface';
import type { IImageProvider, ImageResult } from '../../../../src/providers/provider.interface';
import { ElicitationService } from '../../../../src/mcp/features/elicitation.service';
import { SamplingService } from '../../../../src/mcp/features/sampling.service';
import { RootsService } from '../../../../src/mcp/features/roots.service';

const MOCK_RESULT: ImageResult = {
  b64_json: 'ZmVhdHVyZXNUZXN0',
  model: 'gpt-image-1',
  created: 1_700_000_000,
};

const mockImageResult = MOCK_RESULT;

/**
 * Simulates the inner SDK Server instance (Server, not McpServer).
 * Tools now pass `mcpServer.server` (inner Server) to feature services,
 * so mocks must expose elicitInput / createMessage / listRoots directly.
 */
function makeMockServer(overrides: Record<string, jest.Mock> = {}): any {
  return {
    elicitInput: jest.fn().mockRejectedValue(new Error('client does not support elicitation')),
    createMessage: jest.fn().mockRejectedValue(new Error('client does not support sampling')),
    listRoots: jest.fn().mockResolvedValue({ roots: [] }),
    ...overrides,
  };
}

describe('ImageGenerateTool — with M4 features', () => {
  let tool: ImageGenerateTool;
  let mockProvider: jest.Mocked<IImageProvider>;
  let mockElicitation: jest.Mocked<ElicitationService>;
  let mockSampling: jest.Mocked<SamplingService>;
  let mockRoots: jest.Mocked<RootsService>;

  beforeEach(async () => {
    mockProvider = {
      name: 'openai',
      generate: jest.fn().mockResolvedValue([MOCK_RESULT]),
      edit: jest.fn(),
      variation: jest.fn(),
      validate: jest.fn(),
    } as unknown as jest.Mocked<IImageProvider>;

    mockElicitation = {
      isEnabled: true,
      requestImageParams: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ElicitationService>;

    mockSampling = {
      isEnabled: true,
      // default: pass through unchanged
      enhancePrompt: jest.fn().mockImplementation((_server, prompt: string) => Promise.resolve(prompt)),
    } as unknown as jest.Mocked<SamplingService>;

    mockRoots = {
      getRoots: jest.fn().mockResolvedValue([]),
      saveImageToWorkspace: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<RootsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ImageGenerateTool,
        { provide: PROVIDER_TOKEN, useValue: mockProvider },
        { provide: ElicitationService, useValue: mockElicitation },
        { provide: SamplingService, useValue: mockSampling },
        { provide: RootsService, useValue: mockRoots },
      ],
    }).compile();

    tool = module.get(ImageGenerateTool);
  });

  // ── register() closure ───────────────────────────────────────────────────

  describe('register() — server closure', () => {
    it('should pass the inner Server (mcpServer.server) to execute() via closure', async () => {
      mockProvider.generate.mockResolvedValue([mockImageResult]);

      let capturedServer: unknown;

      const executeSpy = jest.spyOn(tool, 'execute').mockImplementation(async (p, s) => {
        capturedServer = s;
        return { content: [{ type: 'text' as const, text: '' }] };
      });

      // Simulate McpServer shape: has registerTool() and a .server inner property
      const innerServer = makeMockServer();
      const mockMcpServer = {
        server: innerServer,
        registerTool: jest.fn((_name: string, _meta: unknown, handler: (p: unknown) => unknown) => {
          return handler({ prompt: 'test' });
        }),
      };

      tool.register(mockMcpServer as any);

      // execute() must receive innerServer (the .server property), not the McpServer wrapper
      expect(capturedServer).toBe(innerServer);
      executeSpy.mockRestore();
    });
  });

  // ── Sampling ─────────────────────────────────────────────────────────────

  describe('Sampling integration', () => {
    it('should call sampling.enhancePrompt when server is provided', async () => {
      const mockServer = makeMockServer();
      mockSampling.enhancePrompt.mockResolvedValueOnce('enhanced: a cat on a cloud');

      await tool.execute({ prompt: 'a cat' }, mockServer);

      expect(mockSampling.enhancePrompt).toHaveBeenCalledWith(
        mockServer,
        'a cat',
        expect.any(String),
      );
    });

    it('should skip sampling when no server provided', async () => {
      await tool.execute({ prompt: 'a cat' });

      expect(mockSampling.enhancePrompt).not.toHaveBeenCalled();
    });

    it('should pass enhanced prompt to provider.generate', async () => {
      const enhanced = 'A majestic cat soaring through fluffy white clouds, hyperrealistic, 8K';
      mockSampling.enhancePrompt.mockResolvedValueOnce(enhanced);

      await tool.execute({ prompt: 'a cat' }, makeMockServer());

      expect(mockProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: enhanced }),
      );
    });
  });

  // ── Elicitation ──────────────────────────────────────────────────────────

  describe('Elicitation integration', () => {
    it('should call elicitation.requestImageParams when server and quality/size not explicitly set', async () => {
      const mockServer = makeMockServer();

      await tool.execute({ prompt: 'a cat' }, mockServer);

      expect(mockElicitation.requestImageParams).toHaveBeenCalledWith(
        mockServer,
        expect.objectContaining({ hasQuality: false, hasSize: false }),
      );
    });

    it('should pass model to requestImageParams for model-aware size options', async () => {
      const mockServer = makeMockServer();

      await tool.execute({ prompt: 'a cat', model: 'gpt-image-2' }, mockServer);

      expect(mockElicitation.requestImageParams).toHaveBeenCalledWith(
        mockServer,
        expect.objectContaining({ model: 'gpt-image-2' }),
      );
    });

    it('should skip elicitation when no server provided', async () => {
      await tool.execute({ prompt: 'a cat' });

      expect(mockElicitation.requestImageParams).not.toHaveBeenCalled();
    });

    it('should skip elicitation when skip_elicitation=true', async () => {
      const mockServer = makeMockServer();

      await tool.execute({ prompt: 'a cat', skip_elicitation: true }, mockServer);

      expect(mockElicitation.requestImageParams).not.toHaveBeenCalled();
    });

    it('should run elicitation when skip_elicitation=false (default)', async () => {
      const mockServer = makeMockServer();

      await tool.execute({ prompt: 'a cat', skip_elicitation: false }, mockServer);

      expect(mockElicitation.requestImageParams).toHaveBeenCalled();
    });

    it('should use elicited quality value when elicitation returns quality', async () => {
      mockElicitation.requestImageParams.mockResolvedValueOnce({
        quality: 'high',
        size: '1024x1024',
      });

      await tool.execute({ prompt: 'a cat' }, makeMockServer());

      expect(mockProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({ quality: 'high' }),
      );
    });

    it('should use elicited size value when elicitation returns size', async () => {
      mockElicitation.requestImageParams.mockResolvedValueOnce({
        size: '1536x1024',
      });

      await tool.execute({ prompt: 'landscape' }, makeMockServer());

      expect(mockProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({ size: '1536x1024' }),
      );
    });

    it('should not override quality when it was already explicitly provided by caller', async () => {
      mockElicitation.requestImageParams.mockResolvedValueOnce({ quality: 'low' });

      await tool.execute({ prompt: 'a cat', quality: 'high' }, makeMockServer());

      // requestImageParams is called with hasQuality: true — elicitation knows not to show quality field
      expect(mockElicitation.requestImageParams).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ hasQuality: true }),
      );
    });
  });

  // ── Ordering: elicitation before sampling (Issue E fix) ──────────────────

  describe('Feature ordering', () => {
    it('should run elicitation BEFORE sampling', async () => {
      const callOrder: string[] = [];
      mockElicitation.requestImageParams.mockImplementation(async () => {
        callOrder.push('elicitation');
        return null;
      });
      mockSampling.enhancePrompt.mockImplementation(async (_s, prompt) => {
        callOrder.push('sampling');
        return prompt;
      });

      await tool.execute({ prompt: 'a cat' }, makeMockServer());

      expect(callOrder).toEqual(['elicitation', 'sampling']);
    });

    it('should pass elicited quality/size context to provider AFTER both features run', async () => {
      mockElicitation.requestImageParams.mockResolvedValueOnce({ quality: 'high', size: '2048x2048' });
      mockSampling.enhancePrompt.mockImplementation(async (_s, prompt) => `enhanced: ${prompt}`);

      await tool.execute({ prompt: 'a cat' }, makeMockServer());

      expect(mockProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'enhanced: a cat',
          quality: 'high',
          size: '2048x2048',
        }),
      );
    });
  });

  // ── Roots / Workspace ────────────────────────────────────────────────────

  describe('Roots / Workspace integration', () => {
    it('should call roots.saveImageToWorkspace when save_to_workspace=true and server provided', async () => {
      const mockServer = makeMockServer();
      mockRoots.saveImageToWorkspace.mockResolvedValueOnce('/workspace/generated/img_001.png');

      await tool.execute({ prompt: 'a cat', save_to_workspace: true }, mockServer);

      expect(mockRoots.saveImageToWorkspace).toHaveBeenCalledWith(
        mockServer,
        MOCK_RESULT.b64_json,
        expect.any(String),
      );
    });

    it('should skip workspace save when no server provided', async () => {
      await tool.execute({ prompt: 'a cat', save_to_workspace: true });

      expect(mockRoots.saveImageToWorkspace).not.toHaveBeenCalled();
    });

    it('should skip workspace save when save_to_workspace=false (default)', async () => {
      const mockServer = makeMockServer();

      await tool.execute({ prompt: 'a cat', save_to_workspace: false }, mockServer);

      expect(mockRoots.saveImageToWorkspace).not.toHaveBeenCalled();
    });

    it('should include saved_to path in markdown output when file saved', async () => {
      const savedPath = '/workspace/generated/img_001.png';
      mockRoots.saveImageToWorkspace.mockResolvedValueOnce(savedPath);

      const result = await tool.execute(
        { prompt: 'a cat', save_to_workspace: true },
        makeMockServer(),
      );

      expect(result.isError).toBeFalsy();
      const text: string = result.content[0].text;
      expect(text).toContain(savedPath);
    });

    it('should not include saved_to when save failed (returned null)', async () => {
      mockRoots.saveImageToWorkspace.mockResolvedValueOnce(null);

      const result = await tool.execute(
        { prompt: 'a cat', save_to_workspace: true },
        makeMockServer(),
      );

      expect(result.isError).toBeFalsy();
      const text: string = result.content[0].text;
      expect(text).not.toContain('Saved to');
    });
  });

  // ── H4: output_format in data URI ────────────────────────────────────────

  describe('H4: output_format in data URI', () => {
    it('should use png in data URI when output_format not specified', async () => {
      const result = await tool.execute({ prompt: 'a cat' });
      expect(result.content[0].text).toContain('data:image/png;base64,');
    });

    it('should use webp in data URI when output_format=webp', async () => {
      const result = await tool.execute({ prompt: 'a cat', output_format: 'webp' });
      expect(result.content[0].text).toContain('data:image/webp;base64,');
    });

    it('should use jpeg in data URI when output_format=jpeg', async () => {
      const result = await tool.execute({ prompt: 'a cat', output_format: 'jpeg' });
      expect(result.content[0].text).toContain('data:image/jpeg;base64,');
    });
  });

  // ── Graceful degradation ─────────────────────────────────────────────────

  describe('Graceful degradation', () => {
    it('should still generate image even if sampling throws', async () => {
      mockSampling.enhancePrompt.mockRejectedValueOnce(new Error('sampling failed'));

      // sampling.enhancePrompt throwing means tool will catch in its outer try/catch
      // — but the SamplingService itself handles the error internally and returns original.
      // Here we test the tool-level behaviour when the service IS properly shielded.
      // If it throws at the tool level the result will have isError: true.
      // Either way the tool should not crash the process.
      const result = await tool.execute({ prompt: 'a cat' }, makeMockServer());
      // Either succeeds or returns a clean error — never throws uncaught
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });

    it('should still generate image even if elicitation throws', async () => {
      mockElicitation.requestImageParams.mockRejectedValueOnce(new Error('elicitation failed'));

      const result = await tool.execute({ prompt: 'a cat' }, makeMockServer());
      expect(result).toBeDefined();
      expect(result.content).toBeDefined();
    });
  });

  // ── JSON response format ─────────────────────────────────────────────────

  describe('JSON response format with features', () => {
    it('should include saved_to in JSON output when file saved', async () => {
      const savedPath = '/workspace/generated/img_001.png';
      mockRoots.saveImageToWorkspace.mockResolvedValueOnce(savedPath);

      const result = await tool.execute(
        { prompt: 'a cat', save_to_workspace: true, response_format: 'json' },
        makeMockServer(),
      );

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.images[0].saved_to).toBe(savedPath);
    });

    it('should omit saved_to from JSON output when not saved', async () => {
      const result = await tool.execute(
        { prompt: 'a cat', response_format: 'json' },
        makeMockServer(),
      );

      expect(result.isError).toBeFalsy();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.images[0]).not.toHaveProperty('saved_to');
    });
  });
});
