import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  ImageGenerateSchema,
  ImageEditSchema,
  ImageVariationSchema,
  resolveModeration,
  ResponseFormat,
  isArbitraryResolution,
  isExperimentalResolution,
  validateArbitrarySize,
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

    it('accepts former dall-e-3 size "1792x1024" as valid gpt-image-2 arbitrary WxH', () => {
      // 1792×1024: both multiples of 16, ratio 1.75:1, pixels 1,835,008 — all constraints satisfied
      const result = ImageGenerateSchema.safeParse({ prompt: 'test', size: '1792x1024' });
      expect(result.success).toBe(true);
    });

    it('accepts former dall-e-3 size "1024x1792" as valid gpt-image-2 arbitrary WxH', () => {
      // 1024×1792: both multiples of 16, ratio 1.75:1, pixels 1,835,008 — all constraints satisfied
      const result = ImageGenerateSchema.safeParse({ prompt: 'test', size: '1024x1792' });
      expect(result.success).toBe(true);
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
// ImageGenerateSchema — gpt-image-2 arbitrary resolution
// ---------------------------------------------------------------------------
describe('ImageGenerateSchema — gpt-image-2 arbitrary resolution', () => {
  describe('valid fixed presets still work', () => {
    it('"auto" is accepted', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: 'auto' });
      expect(result.success).toBe(true);
    });

    it('"1024x1024" is accepted', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '1024x1024' });
      expect(result.success).toBe(true);
    });

    it('"1536x1024" is accepted', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '1536x1024' });
      expect(result.success).toBe(true);
    });

    it('"1024x1536" is accepted', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '1024x1536' });
      expect(result.success).toBe(true);
    });
  });

  describe('valid arbitrary sizes', () => {
    it('"2048x2048" succeeds (ratio 1:1, pixels 4,194,304)', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '2048x2048' });
      expect(result.success).toBe(true);
    });

    it('"2560x1440" succeeds (boundary — exactly at experimental threshold)', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '2560x1440' });
      expect(result.success).toBe(true);
    });

    it('"3072x1024" succeeds (ratio exactly 3:1, pixels 3,145,728)', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '3072x1024' });
      expect(result.success).toBe(true);
    });

    it('"1024x640" succeeds (min pixels 655,360, ratio 1.6:1)', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '1024x640' });
      expect(result.success).toBe(true);
    });

    it('"2880x2880" succeeds (max pixels 8,294,400, ratio 1:1)', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '2880x2880' });
      expect(result.success).toBe(true);
    });

    it('"2048x1152" succeeds (16:9 widescreen, pixels 2,359,296)', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '2048x1152' });
      expect(result.success).toBe(true);
    });
  });

  describe('invalid: non-multiple of 16', () => {
    it('"1025x1024" fails with "multiple of 16" message', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '1025x1024' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues.map(i => i.message).join(' ');
        expect(msg).toContain('multiple of 16');
      }
    });

    it('"1024x1023" fails with "multiple of 16" message', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '1024x1023' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues.map(i => i.message).join(' ');
        expect(msg).toContain('multiple of 16');
      }
    });
  });

  describe('invalid: max edge ≥ 3840', () => {
    it('"3840x1024" fails with "3840" in message', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '3840x1024' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues.map(i => i.message).join(' ');
        expect(msg).toContain('3840');
      }
    });

    it('"4096x1024" fails with "3840" in message', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '4096x1024' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues.map(i => i.message).join(' ');
        expect(msg).toContain('3840');
      }
    });
  });

  describe('invalid: ratio > 3:1', () => {
    it('"3088x1024" fails (3.0078...:1) with "ratio" or "3:1" in message', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '3088x1024' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues.map(i => i.message).join(' ');
        expect(msg.includes('ratio') || msg.includes('3:1')).toBe(true);
      }
    });

    it('"1024x3088" fails (portrait) with "ratio" or "3:1" in message', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '1024x3088' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues.map(i => i.message).join(' ');
        expect(msg.includes('ratio') || msg.includes('3:1')).toBe(true);
      }
    });
  });

  describe('invalid: total pixels below minimum', () => {
    it('"640x1008" fails (645,120 pixels) with "pixels" or "655" in message', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '640x1008' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues.map(i => i.message).join(' ');
        expect(msg.includes('pixels') || msg.includes('655')).toBe(true);
      }
    });
  });

  describe('invalid: total pixels above maximum', () => {
    it('"3824x2176" fails (8,321,024 pixels) with "pixels" or "8,294" in message', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '3824x2176' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues.map(i => i.message).join(' ');
        expect(msg.includes('pixels') || msg.includes('8,294')).toBe(true);
      }
    });
  });

  describe('invalid: bad format', () => {
    it('"wide" fails with "Invalid size" in message', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: 'wide' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues.map(i => i.message).join(' ');
        expect(msg).toContain('Invalid size');
      }
    });

    it('"1024" fails with "Invalid size" in message', () => {
      const result = ImageGenerateSchema.safeParse({ prompt: 'x', size: '1024' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const msg = result.error.issues.map(i => i.message).join(' ');
        expect(msg).toContain('Invalid size');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// isArbitraryResolution()
// ---------------------------------------------------------------------------
describe('isArbitraryResolution()', () => {
  it('"auto" → false', () => {
    expect(isArbitraryResolution('auto')).toBe(false);
  });

  it('"1024x1024" → false (it is a preset)', () => {
    expect(isArbitraryResolution('1024x1024')).toBe(false);
  });

  it('"2048x2048" → true', () => {
    expect(isArbitraryResolution('2048x2048')).toBe(true);
  });

  it('undefined → false', () => {
    expect(isArbitraryResolution(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isExperimentalResolution()
// ---------------------------------------------------------------------------
describe('isExperimentalResolution()', () => {
  it('"1024x1024" → false (preset)', () => {
    expect(isExperimentalResolution('1024x1024')).toBe(false);
  });

  it('"2560x1440" → false (boundary — NOT experimental)', () => {
    expect(isExperimentalResolution('2560x1440')).toBe(false);
  });

  it('"2576x1440" → true (2576×1440 = 3,709,440 > 3,686,400)', () => {
    expect(isExperimentalResolution('2576x1440')).toBe(true);
  });

  it('"auto" → false', () => {
    expect(isExperimentalResolution('auto')).toBe(false);
  });

  it('undefined → false', () => {
    expect(isExperimentalResolution(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateArbitrarySize() — direct tests
// ---------------------------------------------------------------------------
describe('validateArbitrarySize()', () => {
  it('"2048x2048" does not throw', () => {
    expect(() => validateArbitrarySize('2048x2048')).not.toThrow();
  });

  it('"1025x1024" throws containing "multiple of 16"', () => {
    expect(() => validateArbitrarySize('1025x1024')).toThrow('multiple of 16');
  });

  it('"3840x1024" throws containing "3840"', () => {
    expect(() => validateArbitrarySize('3840x1024')).toThrow('3840');
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
