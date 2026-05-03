import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  ImageGenerateSchema,
  ImageEditSchema,
  ImageVariationSchema,
  resolveModeration,
  ResponseFormat,
} from '../../../../src/mcp/tools/schemas';

// ---------------------------------------------------------------------------
// ImageGenerateSchema
// ---------------------------------------------------------------------------
describe('ImageGenerateSchema', () => {
  describe('quality enum', () => {
    it('accepts valid quality values: auto, high, medium, low', () => {
      for (const q of ['auto', 'high', 'medium', 'low'] as const) {
        const result = ImageGenerateSchema.safeParse({ prompt: 'test', quality: q });
        expect(result.success).toBe(true);
      }
    });

    it('rejects removed dall-e-3 quality value "hd"', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'test', quality: 'hd' });
      expect(result.success).toBe(false);
    });

    it('rejects removed dall-e-3 quality value "standard"', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'test', quality: 'standard' });
      expect(result.success).toBe(false);
    });

    it('defaults quality to "auto" when omitted', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'test' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quality).toBe('auto');
    });
  });

  describe('size enum', () => {
    it('accepts valid gpt-image-* sizes', () => {
      for (const s of ['auto', '1024x1024', '1536x1024', '1024x1536'] as const) {
        const result = ImageGenerateSchema.safeParse({ prompt: 'test', size: s });
        expect(result.success).toBe(true);
      }
    });

    it('rejects dall-e-2 size "256x256"', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'test', size: '256x256' });
      expect(result.success).toBe(false);
    });

    it('rejects dall-e-2 size "512x512"', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'test', size: '512x512' });
      expect(result.success).toBe(false);
    });

    it('rejects dall-e-3 size "1792x1024"', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'test', size: '1792x1024' });
      expect(result.success).toBe(false);
    });

    it('rejects dall-e-3 size "1024x1792"', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'test', size: '1024x1792' });
      expect(result.success).toBe(false);
    });

    it('defaults size to "auto" when omitted', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'test' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.size).toBe('auto');
    });
  });

  describe('defaults and required fields', () => {
    it('requires a non-empty prompt', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: '' });
      expect(result.success).toBe(false);
    });

    it('defaults n to 1', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'test' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.n).toBe(1);
    });

    it('defaults response_format to MARKDOWN', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'test' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.response_format).toBe(ResponseFormat.MARKDOWN);
    });

    it('defaults save_to_workspace to false', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'test' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.save_to_workspace).toBe(false);
    });

    it('defaults skip_elicitation to false', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'test' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.skip_elicitation).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// ImageEditSchema
// ---------------------------------------------------------------------------
describe('ImageEditSchema', () => {
  describe('quality enum', () => {
    it('accepts valid quality values: auto, high, medium, low', () => {
      for (const q of ['auto', 'high', 'medium', 'low'] as const) {
        const result = ImageEditSchema.safeParse({
          image: 'base64data',
          prompt: 'edit this',
          quality: q,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects removed dall-e-3 quality value "standard"', () => {
      const result = ImageEditSchema.safeParse({
        image: 'base64data',
        prompt: 'edit this',
        quality: 'standard',
      });
      expect(result.success).toBe(false);
    });

    it('rejects removed dall-e-3 quality value "hd"', () => {
      const result = ImageEditSchema.safeParse({
        image: 'base64data',
        prompt: 'edit this',
        quality: 'hd',
      });
      expect(result.success).toBe(false);
    });

    it('defaults quality to "auto" when omitted', () => {
      const result = ImageEditSchema.safeParse({ image: 'base64data', prompt: 'edit this' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.quality).toBe('auto');
    });
  });

  describe('size enum', () => {
    it('accepts valid gpt-image-* edit sizes', () => {
      for (const s of ['auto', '1024x1024', '1536x1024', '1024x1536'] as const) {
        const result = ImageEditSchema.safeParse({
          image: 'base64data',
          prompt: 'edit this',
          size: s,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects dall-e-2 size "256x256"', () => {
      const result = ImageEditSchema.safeParse({
        image: 'base64data',
        prompt: 'edit this',
        size: '256x256',
      });
      expect(result.success).toBe(false);
    });

    it('rejects dall-e-2 size "512x512"', () => {
      const result = ImageEditSchema.safeParse({
        image: 'base64data',
        prompt: 'edit this',
        size: '512x512',
      });
      expect(result.success).toBe(false);
    });

    it('defaults size to "auto" when omitted', () => {
      const result = ImageEditSchema.safeParse({ image: 'base64data', prompt: 'edit this' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.size).toBe('auto');
    });
  });
});

// ---------------------------------------------------------------------------
// ImageVariationSchema — unchanged, just verify it still works
// ---------------------------------------------------------------------------
describe('ImageVariationSchema', () => {
  it('parses a valid variation request', () => {
    const result = ImageVariationSchema.safeParse({ image: 'base64data' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.size).toBe('1024x1024');
      expect(result.data.n).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveModeration
// ---------------------------------------------------------------------------
describe('resolveModeration', () => {
  const originalEnv = process.env['ALLOW_LOW_MODERATION'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['ALLOW_LOW_MODERATION'];
    } else {
      process.env['ALLOW_LOW_MODERATION'] = originalEnv;
    }
  });

  it('returns "auto" when requested is undefined', () => {
    delete process.env['ALLOW_LOW_MODERATION'];
    expect(resolveModeration(undefined)).toBe('auto');
  });

  it('returns "auto" when requested is "auto"', () => {
    delete process.env['ALLOW_LOW_MODERATION'];
    expect(resolveModeration('auto')).toBe('auto');
  });

  it('downgrades "low" to "auto" when ALLOW_LOW_MODERATION is unset', () => {
    delete process.env['ALLOW_LOW_MODERATION'];
    expect(resolveModeration('low')).toBe('auto');
  });

  it('downgrades "low" to "auto" when ALLOW_LOW_MODERATION is "false"', () => {
    process.env['ALLOW_LOW_MODERATION'] = 'false';
    expect(resolveModeration('low')).toBe('auto');
  });

  it('downgrades "low" to "auto" when ALLOW_LOW_MODERATION is "1"', () => {
    process.env['ALLOW_LOW_MODERATION'] = '1';
    expect(resolveModeration('low')).toBe('auto');
  });

  it('allows "low" when ALLOW_LOW_MODERATION is "true"', () => {
    process.env['ALLOW_LOW_MODERATION'] = 'true';
    expect(resolveModeration('low')).toBe('low');
  });

  it('returns "auto" when ALLOW_LOW_MODERATION is "true" but requested is undefined', () => {
    process.env['ALLOW_LOW_MODERATION'] = 'true';
    expect(resolveModeration(undefined)).toBe('auto');
  });

  it('returns "auto" when ALLOW_LOW_MODERATION is "true" but requested is "auto"', () => {
    process.env['ALLOW_LOW_MODERATION'] = 'true';
    expect(resolveModeration('auto')).toBe('auto');
  });
});
