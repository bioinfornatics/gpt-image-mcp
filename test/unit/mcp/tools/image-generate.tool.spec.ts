import { Test, type TestingModule } from '@nestjs/testing';
import { ImageGenerateTool } from '../../../../src/mcp/tools/image-generate.tool';
import { PROVIDER_TOKEN } from '../../../../src/providers/provider.interface';
import { ElicitationService } from '../../../../src/mcp/features/elicitation.service';
import { SamplingService } from '../../../../src/mcp/features/sampling.service';
import { RootsService } from '../../../../src/mcp/features/roots.service';
import { ImageStorageService } from '../../../../src/mcp/features/image-storage.service';
import type { IImageProvider, ImageResult } from '../../../../src/providers/provider.interface';
import { LATEST_MODEL } from '../../../../src/config/models';
import { ImageProviderError } from '../../../../src/providers/provider.interface';

const mockImageResult: ImageResult = {
  b64_json: 'ZmFrZWJhc2U2NA==',
  format: 'png',
  mimeType: 'image/png',
  model: 'gpt-image-1',
  created: 1_700_000_000,
};

describe('ImageGenerateTool', () => {
  let tool: ImageGenerateTool;
  let mockProvider: jest.Mocked<Pick<IImageProvider, 'generate' | 'edit' | 'variation' | 'validate' | 'name' | 'configuredModel'>>;

  beforeEach(async () => {
    mockProvider = {
      name: 'openai',
      configuredModel: undefined,
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
        { provide: SamplingService, useValue: { isEnabled: false, enhancePrompt: jest.fn().mockImplementation((_s, p, _ctx) => Promise.resolve(p)) } },
        { provide: RootsService, useValue: { getRoots: jest.fn().mockResolvedValue([]), saveImageToWorkspace: jest.fn().mockResolvedValue(null) } },
        { provide: ImageStorageService, useValue: { saveImage: jest.fn().mockImplementation((_b64: string, format: string) => Promise.resolve(`/tmp/gpt-image-mcp/image.${format}`)) } },
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


    it('uses the configured fixed deployment when model is omitted', async () => {
      mockProvider.configuredModel = 'MAI-Image-2.5';
      mockProvider.generate.mockResolvedValue([{ ...mockImageResult, model: 'MAI-Image-2.5' }]);
      const result = await tool.execute({ prompt: 'a cat' });
      expect(result.isError).toBeUndefined();
      expect(mockProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'MAI-Image-2.5', quality: 'auto' }),
      );
    });

    it('rejects an explicit model that conflicts with the configured fixed deployment', async () => {
      mockProvider.configuredModel = 'MAI-Image-2.5';
      const result = await tool.execute({ prompt: 'a cat', model: 'gpt-image-2' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('configured deployment is "MAI-Image-2.5"');
      expect(result.content[0].text.toLowerCase()).toContain('omit "model"');
      expect(mockProvider.generate).not.toHaveBeenCalled();
    });
  });

  describe('Successful Generation', () => {
    beforeEach(() => {
      mockProvider.generate.mockResolvedValue([mockImageResult]);
    });

    it('should return markdown by default containing base64 data', async () => {
      const result = await tool.execute({ prompt: 'a cat' });
      expect(result.isError).toBeUndefined();
      expect(result.content).toContainEqual(expect.objectContaining({ type: 'image', data: mockImageResult.b64_json, mimeType: 'image/png' }));
      expect(result.content[0].text).toContain('# Generated Image');
    });

    it('should return JSON when response_format is json', async () => {
      const result = await tool.execute({ prompt: 'a cat', response_format: 'json' });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.images[0].saved_to).toContain('/tmp/gpt-image-mcp/');
      expect(parsed.model).toBe(mockImageResult.model);
    });

    it('uses an explicit gpt-image-2 fallback only after an output safety block', async () => {
      mockProvider.availableModels = ['MAI-Image-2.5', 'gpt-image-2'];
      mockProvider.defaultModel = 'MAI-Image-2.5';
      mockProvider.generate
        .mockRejectedValueOnce(new ImageProviderError({
          code: 'CONTENT_SAFETY_BLOCK', message: 'Output filtered.', provider: 'azure',
          model: 'MAI-Image-2.5', retryable: true, stage: 'output',
        }))
        .mockResolvedValueOnce([{ ...mockImageResult, model: 'gpt-image-2' }]);
      const result = await tool.execute({
        prompt: 'a cat', model: 'MAI-Image-2.5', fallback_model: 'gpt-image-2', response_format: 'json',
      });
      expect(mockProvider.generate).toHaveBeenCalledTimes(2);
      expect(mockProvider.generate).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'gpt-image-2' }));
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(expect.objectContaining({
        requested_model: 'MAI-Image-2.5', effective_model: 'gpt-image-2',
        fallback_used: true, fallback_reason: 'CONTENT_SAFETY_BLOCK',
      }));
    });

    it('does not fallback for prompt-stage safety blocks', async () => {
      mockProvider.availableModels = ['MAI-Image-2.5', 'gpt-image-2'];
      mockProvider.generate.mockRejectedValue(new ImageProviderError({
        code: 'CONTENT_SAFETY_BLOCK', message: 'Prompt filtered.', provider: 'azure',
        model: 'MAI-Image-2.5', retryable: false, stage: 'prompt',
      }));
      const result = await tool.execute({ prompt: 'x', model: 'MAI-Image-2.5', fallback_model: 'gpt-image-2' });
      expect(result.isError).toBe(true);
      expect(mockProvider.generate).toHaveBeenCalledTimes(1);
    });

    it('should not include an experimental warning for a preset size', async () => {
      const result = await tool.execute({ prompt: 'a cat', size: '1024x1024' });
      expect(result.content[0].text).not.toContain('Experimental');
    });

    it('should include a markdown experimental warning for arbitrary sizes above 2560x1440', async () => {
      const result = await tool.execute({ prompt: 'a cat', size: '2880x2880' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('Experimental resolution');
    });

    it('should not warn at the 2560x1440 boundary itself', async () => {
      const result = await tool.execute({ prompt: 'a cat', size: '2560x1440' });
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).not.toContain('Experimental');
    });

    it('should include a "warning" field in JSON output for arbitrary sizes above 2560x1440', async () => {
      const result = await tool.execute({ prompt: 'a cat', size: '2880x2880', response_format: 'json' });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.warning).toContain('Experimental resolution');
    });

    it('should omit the JSON "warning" field for sizes at/below the threshold', async () => {
      const result = await tool.execute({ prompt: 'a cat', size: '1024x1024', response_format: 'json' });
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.warning).toBeUndefined();
    });

    it('should pass all parameters through to the provider (moderation gated to auto without IMAGE_ALLOW_LOW_MODERATION)', async () => {
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
      // moderation='low' is silently gated to 'auto' by resolveModeration()
      // unless IMAGE_ALLOW_LOW_MODERATION=true is set in the environment
      expect(mockProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'dall-e-3',
          size: '1024x1024',
          quality: 'high',
          background: 'transparent',
          output_format: 'webp',
          output_compression: 80,
          moderation: 'auto',
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

  describe('moderation parameter', () => {
    beforeEach(() => {
      mockProvider.generate.mockResolvedValue([mockImageResult]);
    });

    it('should call provider.generate with moderation:auto when moderation is not set', async () => {
      await tool.execute({ prompt: 'a cat' });
      expect(mockProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({ moderation: 'auto' }),
      );
    });

    it('should call provider.generate with moderation:auto when moderation=low and IMAGE_ALLOW_LOW_MODERATION is unset', async () => {
      const original = process.env['IMAGE_ALLOW_LOW_MODERATION'];
      delete process.env['IMAGE_ALLOW_LOW_MODERATION'];
      await tool.execute({ prompt: 'a cat', moderation: 'low' });
      expect(mockProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({ moderation: 'auto' }),
      );
      if (original !== undefined) process.env['IMAGE_ALLOW_LOW_MODERATION'] = original;
    });

    it('should call provider.generate with moderation:low when moderation=low and IMAGE_ALLOW_LOW_MODERATION=true', async () => {
      process.env['IMAGE_ALLOW_LOW_MODERATION'] = 'true';
      await tool.execute({ prompt: 'a cat', moderation: 'low' });
      expect(mockProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({ moderation: 'low' }),
      );
      delete process.env['IMAGE_ALLOW_LOW_MODERATION'];
    });
  });

  describe('Error Handling', () => {
    it('should return isError when provider throws', async () => {
      mockProvider.generate.mockRejectedValue(new Error('Rate limit exceeded'));
      const result = await tool.execute({ prompt: 'a cat' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Rate limit exceeded');
    });

    it('returns structured provider safety evidence in the MCP error result', async () => {
      mockProvider.generate.mockRejectedValue(new ImageProviderError({
        code: 'CONTENT_SAFETY_BLOCK',
        message: 'MAI output filtering blocked a generated candidate; the prompt is not proven unsafe.',
        provider: 'azure',
        model: 'MAI-Image-2.5',
        retryable: true,
        stage: 'output',
        status: 400,
        providerCode: 'content_safety_violation',
        label: 'MultiSeverity_SexualScore',
        requestId: 'request-123',
      }));
      const result = await tool.execute({ prompt: 'a safe prompt' });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ error: expect.objectContaining({
        code: 'CONTENT_SAFETY_BLOCK', model: 'MAI-Image-2.5', stage: 'output',
        retryable: true, max_retries_recommended: 1, image_created: false, request_id: 'request-123',
      }) });
      expect(result.content[0].text).not.toContain('the prompt violated');
    });

    it('should not expose raw error internals', async () => {
      mockProvider.generate.mockRejectedValue(new Error('sk-secret-key exposed in error'));
      const result = await tool.execute({ prompt: 'a cat' });
      // The message should still contain a useful error but provider should have masked key
      expect(result.isError).toBe(true);
    });
  });
});
