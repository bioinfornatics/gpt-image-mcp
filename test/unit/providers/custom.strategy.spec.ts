import { describe, it, expect, beforeEach } from 'bun:test';
import { CustomStrategy } from '../../../src/providers/strategies/custom.strategy';

describe('CustomStrategy', () => {
  let strategy: CustomStrategy;

  beforeEach(() => {
    strategy = new CustomStrategy();
  });

  describe('properties', () => {
    it('should have name "custom"', () => {
      expect(strategy.name).toBe('custom');
    });

    it('should have supportsVariation = false', () => {
      expect(strategy.supportsVariation).toBe(false);
    });

    it('should have logPrefix "[Custom]"', () => {
      expect(strategy.logPrefix).toBe('[Custom]');
    });
  });

  describe('resolveModel()', () => {
    it('should return the model from params when provided', () => {
      expect(strategy.resolveModel({ model: 'my-custom-model' })).toBe('my-custom-model');
    });

    it('should return "custom" as default when model is undefined', () => {
      expect(strategy.resolveModel({ model: undefined as unknown as string })).toBe('custom');
    });

    it('should return "custom" as default when model is empty string', () => {
      expect(strategy.resolveModel({ model: '' })).toBe('custom');
    });
  });

  describe('buildGenerateExtras()', () => {
    it('should return only response_format for dall-e models', () => {
      const params = {
        prompt: 'a cat',
        model: 'dall-e-3',
        background: 'transparent' as const,
        output_format: 'png' as const,
      };
      const extras = strategy.buildGenerateExtras(params, 'dall-e-3');
      expect(extras).toEqual({ response_format: 'b64_json' });
    });

    it('should return response_format and extras for non-dall-e models', () => {
      const params = {
        prompt: 'a cat',
        model: 'custom',
        background: 'transparent' as const,
        output_format: 'webp' as const,
        output_compression: 80,
      };
      const extras = strategy.buildGenerateExtras(params, 'custom');
      expect(extras).toEqual({
        response_format: 'b64_json',
        background: 'transparent',
        output_format: 'webp',
        output_compression: 80,
      });
    });

    it('should omit undefined optional fields', () => {
      const params = { prompt: 'a cat', model: 'custom' };
      const extras = strategy.buildGenerateExtras(params, 'custom');
      expect(extras).toEqual({ response_format: 'b64_json' });
      expect(extras).not.toHaveProperty('background');
      expect(extras).not.toHaveProperty('output_format');
      expect(extras).not.toHaveProperty('output_compression');
    });
  });

  describe('buildEditExtras()', () => {
    it('should return response_format: b64_json by default', () => {
      const params = { image: 'base64', prompt: 'edit this', model: 'custom' };
      const extras = strategy.buildEditExtras(params);
      expect(extras['response_format']).toBe('b64_json');
    });

    it('should include quality when provided and not "auto"', () => {
      const params = { image: 'base64', prompt: 'edit this', model: 'custom', quality: 'high' };
      const extras = strategy.buildEditExtras(params);
      expect(extras['quality']).toBe('high');
    });

    it('should not include quality when it is "auto"', () => {
      const params = { image: 'base64', prompt: 'edit this', model: 'custom', quality: 'auto' };
      const extras = strategy.buildEditExtras(params);
      expect(extras).not.toHaveProperty('quality');
    });

    it('should include output_format when provided', () => {
      const params = {
        image: 'base64',
        prompt: 'edit this',
        model: 'custom',
        output_format: 'jpeg' as const,
      };
      const extras = strategy.buildEditExtras(params);
      expect(extras['output_format']).toBe('jpeg');
    });

    it('should not include output_format when not provided', () => {
      const params = { image: 'base64', prompt: 'edit this', model: 'custom' };
      const extras = strategy.buildEditExtras(params);
      expect(extras).not.toHaveProperty('output_format');
    });
  });

  describe('normalizeError()', () => {
    it('should return auth error for 401 in message', () => {
      const err = new Error('401 Unauthorized');
      const result = strategy.normalizeError(err);
      expect(result.message).toBe('Authentication failed (Custom): check CUSTOM_OPENAI_API_KEY.');
    });

    it('should return auth error for "unauthorized" keyword', () => {
      const err = new Error('unauthorized request');
      const result = strategy.normalizeError(err);
      expect(result.message).toBe('Authentication failed (Custom): check CUSTOM_OPENAI_API_KEY.');
    });

    it('should return rate limit error for 429', () => {
      const err = new Error('429 Too Many Requests');
      const result = strategy.normalizeError(err);
      expect(result.message).toContain('Rate limit exceeded (Custom)');
    });

    it('should return rate limit error for "rate limit" keyword', () => {
      const err = new Error('rate limit exceeded');
      const result = strategy.normalizeError(err);
      expect(result.message).toContain('Rate limit exceeded (Custom)');
    });

    it('should return generic Custom error for other errors', () => {
      const err = new Error('Connection refused');
      const result = strategy.normalizeError(err);
      expect(result.message).toContain('Custom OpenAI-compatible endpoint error');
      expect(result.message).toContain('Connection refused');
    });

    it('should handle non-Error thrown values', () => {
      const result = strategy.normalizeError('plain string error');
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('plain string error');
    });

    it('should mask secrets in error messages', () => {
      const err = new Error('sk-my-secret-custom-key-that-is-long-enough-to-mask failed');
      const result = strategy.normalizeError(err);
      expect(result.message).not.toContain('sk-my-secret-custom-key');
    });
  });
});
