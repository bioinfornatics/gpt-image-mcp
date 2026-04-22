import { Test } from '@nestjs/testing';
import { ProviderValidateTool } from '../../../../src/mcp/tools/provider-validate.tool';
import { PROVIDER_TOKEN } from '../../../../src/providers/provider.interface';
import type { IImageProvider, ValidationResult } from '../../../../src/providers/provider.interface';

describe('ProviderValidateTool', () => {
  let tool: ProviderValidateTool;
  let mockProvider: jest.Mocked<Pick<IImageProvider, 'name' | 'validate'>>;

  const makeModule = async (providerName: 'openai' | 'azure') => {
    mockProvider = { name: providerName, validate: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        ProviderValidateTool,
        { provide: PROVIDER_TOKEN, useValue: mockProvider },
      ],
    }).compile();
    tool = module.get(ProviderValidateTool);
  };

  describe('with OpenAI provider', () => {
    beforeEach(() => makeModule('openai'));

    it('should return success message when validation passes', async () => {
      const validResult: ValidationResult = { valid: true, provider: 'openai' };
      mockProvider.validate.mockResolvedValue(validResult);
      const result = await tool.execute({ provider: 'openai' });
      expect(result.content[0].text).toContain('✅');
      expect(result.content[0].text).toContain('valid');
    });

    it('should return error message when validation fails', async () => {
      const failResult: ValidationResult = { valid: false, provider: 'openai', error: 'Invalid API key' };
      mockProvider.validate.mockResolvedValue(failResult);
      const result = await tool.execute({ provider: 'openai' });
      expect(result.content[0].text).toContain('❌');
      expect(result.content[0].text).toContain('Invalid API key');
    });

    it('should return error when requesting wrong provider', async () => {
      const result = await tool.execute({ provider: 'azure' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('not configured');
    });

    it('should reject invalid provider name', async () => {
      const result = await tool.execute({ provider: 'anthropic' });
      expect(result.isError).toBe(true);
    });
  });
});
