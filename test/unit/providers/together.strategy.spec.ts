import { describe, it, expect, beforeEach } from 'bun:test';
import { TogetherStrategy } from '../../../src/providers/strategies/together.strategy';

describe('TogetherStrategy', () => {
  let strategy: TogetherStrategy;

  beforeEach(() => {
    strategy = new TogetherStrategy();
  });

  describe('properties', () => {
    it('should have name "together"', () => {
      expect(strategy.name).toBe('together');
    });

    it('should have supportsVariation = false', () => {
      expect(strategy.supportsVariation).toBe(false);
    });

    it('should have logPrefix "[Together]"', () => {
      expect(strategy.logPrefix).toBe('[Together]');
    });
  });

  describe('resolveModel()', () => {
    it('should return the model from params when provided', () => {
      expect(strategy.resolveModel({ model: 'black-forest-labs/FLUX.1-schnell' })).toBe(
        'black-forest-labs/FLUX.1-schnell',
      );
    });

    it('should return the default FLUX free model when model is undefined', () => {
      expect(strategy.resolveModel({ model: undefined as unknown as string })).toBe(
        'black-forest-labs/FLUX.1-schnell-Free',
      );
    });

    it('should return the default FLUX free model when model is empty', () => {
      expect(strategy.resolveModel({ model: '' })).toBe('black-forest-labs/FLUX.1-schnell-Free');
    });
  });

  describe('buildGenerateExtras()', () => {
    it('should always return response_format: b64_json', () => {
      const params = { prompt: 'a cat', model: 'black-forest-labs/FLUX.1-schnell-Free' };
      const extras = strategy.buildGenerateExtras(params, 'black-forest-labs/FLUX.1-schnell-Free');
      expect(extras).toEqual({ response_format: 'b64_json' });
    });

    it('should not include quality, background, or other params', () => {
      const params = {
        prompt: 'a cat',
        model: 'black-forest-labs/FLUX.1-schnell',
        quality: 'high',
        background: 'transparent' as const,
      };
      const extras = strategy.buildGenerateExtras(params, 'black-forest-labs/FLUX.1-schnell');
      expect(Object.keys(extras)).toEqual(['response_format']);
    });
  });

  describe('buildEditExtras()', () => {
    it('should throw an error indicating edit is not supported', () => {
      const params = { image: 'base64', prompt: 'edit this', model: 'FLUX.1-schnell' };
      expect(() => strategy.buildEditExtras(params)).toThrow(
        'image_edit is not supported by the Together AI provider.',
      );
    });
  });

  describe('normalizeError()', () => {
    it('should return auth error for 401 status in message', () => {
      const err = new Error('401 Unauthorized');
      const result = strategy.normalizeError(err);
      expect(result.message).toBe('Authentication failed: check your TOGETHER_API_KEY.');
    });

    it('should return auth error for "unauthorized" keyword', () => {
      const err = new Error('unauthorized access');
      const result = strategy.normalizeError(err);
      expect(result.message).toBe('Authentication failed: check your TOGETHER_API_KEY.');
    });

    it('should return rate limit error for 429', () => {
      const err = new Error('429 Too Many Requests');
      const result = strategy.normalizeError(err);
      expect(result.message).toContain('Rate limit exceeded (Together AI)');
    });

    it('should return rate limit error for "rate limit" keyword', () => {
      const err = new Error('rate limit hit');
      const result = strategy.normalizeError(err);
      expect(result.message).toContain('Rate limit exceeded (Together AI)');
    });

    it('should return bad request error for 400', () => {
      const err = new Error('400 Bad Request: invalid model');
      const result = strategy.normalizeError(err);
      expect(result.message).toContain('Bad request (Together AI)');
      expect(result.message).toContain('Check model name and parameters.');
    });

    it('should return generic Together AI error for other errors', () => {
      const err = new Error('Internal server error');
      const result = strategy.normalizeError(err);
      expect(result.message).toContain('Together AI error');
    });

    it('should handle non-Error thrown values', () => {
      const result = strategy.normalizeError('string error');
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('string error');
    });

    it('should mask secrets in error messages', () => {
      const err = new Error('sk-togetherxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx request failed');
      const result = strategy.normalizeError(err);
      expect(result.message).not.toContain('sk-together');
    });
  });
});
