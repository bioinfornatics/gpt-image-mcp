import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SamplingService, type ImagePromptContext } from '../../../../src/mcp/features/sampling.service';

function makeService(useSampling: boolean) {
  return Test.createTestingModule({
    providers: [
      SamplingService,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => {
            if (key === 'mcp') return { useSampling };
            return undefined;
          },
        },
      },
    ],
  })
    .compile()
    .then((m) => m.get(SamplingService));
}

const BASE_CTX: ImagePromptContext = { model: 'gpt-image-2' };

describe('SamplingService', () => {
  // ── isEnabled ────────────────────────────────────────────────────────────
  describe('isEnabled', () => {
    it('should be true when USE_SAMPLING=true', async () => {
      const svc = await makeService(true);
      expect(svc.isEnabled).toBe(true);
    });

    it('should be false when USE_SAMPLING=false', async () => {
      const svc = await makeService(false);
      expect(svc.isEnabled).toBe(false);
    });
  });

  // ── enhancePrompt() — control flow ───────────────────────────────────────
  describe('enhancePrompt()', () => {
    it('should return original prompt when disabled', async () => {
      const svc = await makeService(false);
      const result = await svc.enhancePrompt({} as any, 'a cat', BASE_CTX);
      expect(result).toBe('a cat');
    });

    it('should return original prompt when server.createMessage throws', async () => {
      const svc = await makeService(true);
      const mockServer = { createMessage: jest.fn().mockRejectedValue(new Error('not supported')) };
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', BASE_CTX);
      expect(result).toBe('a cat');
    });

    it('should return enhanced prompt when sampling succeeds', async () => {
      const svc = await makeService(true);
      const enhanced = 'A fluffy orange tabby cat sitting on a sun-drenched windowsill, photorealistic, 8K';
      const mockServer = {
        createMessage: jest.fn().mockResolvedValue({
          content: { type: 'text', text: enhanced },
        }),
      };
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', BASE_CTX);
      expect(result).toBe(enhanced);
    });

    it('should return original prompt when sampling response has no text', async () => {
      const svc = await makeService(true);
      const mockServer = {
        createMessage: jest.fn().mockResolvedValue({ content: { type: 'image' } }),
      };
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', BASE_CTX);
      expect(result).toBe('a cat');
    });

    it('should call server.createMessage (not server.request)', async () => {
      const svc = await makeService(true);
      const mockServer = {
        createMessage: jest.fn().mockResolvedValue({
          content: { type: 'text', text: 'enhanced prompt' },
        }),
        request: jest.fn(),
      };
      await svc.enhancePrompt(mockServer as any, 'a cat', BASE_CTX);
      expect(mockServer.createMessage).toHaveBeenCalledTimes(1);
      expect(mockServer.request).not.toHaveBeenCalled();
    });

    it('should include original prompt in sampling request', async () => {
      const svc = await makeService(true);
      let capturedParams: any = null;
      const mockServer = {
        createMessage: jest.fn().mockImplementation((params: any) => {
          capturedParams = params;
          return Promise.resolve({ content: { type: 'text', text: 'enhanced' } });
        }),
      };
      await svc.enhancePrompt(mockServer as any, 'my original prompt', BASE_CTX);
      const messages = capturedParams?.messages ?? [];
      const content = messages.map((m: any) => m.content?.text ?? '').join(' ');
      expect(content).toContain('my original prompt');
    });

    it('should pass systemPrompt to createMessage', async () => {
      const svc = await makeService(true);
      let capturedParams: any = null;
      const mockServer = {
        createMessage: jest.fn().mockImplementation((p: any) => {
          capturedParams = p;
          return Promise.resolve({ content: { type: 'text', text: 'ok' } });
        }),
      };
      await svc.enhancePrompt(mockServer as any, 'a cat', BASE_CTX);
      expect(capturedParams.systemPrompt).toBeDefined();
      expect(capturedParams.systemPrompt.length).toBeGreaterThan(20);
    });

    it('should sanitise LLM response containing null bytes', async () => {
      const svc = await makeService(true);
      const malicious = 'enhanced prompt\0with null byte';
      const mockServer = {
        createMessage: jest.fn().mockResolvedValue({
          content: { type: 'text', text: malicious },
        }),
      };
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', BASE_CTX);
      expect(result).not.toContain('\0');
      expect(result).toBe('enhanced promptwith null byte');
    });

    it('should fall back to original prompt when LLM response exceeds 32000 chars', async () => {
      const svc = await makeService(true);
      const tooLong = 'x'.repeat(33_000);
      const mockServer = {
        createMessage: jest.fn().mockResolvedValue({
          content: { type: 'text', text: tooLong },
        }),
      };
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', BASE_CTX);
      expect(result).toBe('a cat');
    });

    it('should sanitise LLM response with bidi/RTL override characters', async () => {
      const svc = await makeService(true);
      const withBidi = 'enhanced\u202Eprompt'; // RTL override
      const mockServer = {
        createMessage: jest.fn().mockResolvedValue({
          content: { type: 'text', text: withBidi },
        }),
      };
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', BASE_CTX);
      expect(result).not.toContain('\u202E');
      expect(result).toBe('enhancedprompt');
    });

    // ── Context is forwarded to createMessage ────────────────────────────
    it('should pass full context to buildUserMessage (model visible in user content)', async () => {
      const svc = await makeService(true);
      let capturedText = '';
      const mockServer = {
        createMessage: jest.fn().mockImplementation((p: any) => {
          capturedText = p.messages?.[0]?.content?.text ?? '';
          return Promise.resolve({ content: { type: 'text', text: 'ok' } });
        }),
      };
      await svc.enhancePrompt(mockServer as any, 'a cat', {
        model: 'gpt-image-2',
        quality: 'high',
        size: '1536x1024',
      });
      expect(capturedText).toContain('gpt-image-2');
      expect(capturedText).toContain('high');
    });
  });

  // ── resolveMaxTokens() ───────────────────────────────────────────────────
  describe('resolveMaxTokens()', () => {
    it('should return 80 tokens for low quality (draft mode)', () => {
      expect(SamplingService.resolveMaxTokens('low')).toBe(80);
    });

    it('should return 80 tokens for low quality regardless of size', () => {
      expect(SamplingService.resolveMaxTokens('low', '1536x1024')).toBe(80);
    });

    it('should return 350 tokens for high quality + large canvas', () => {
      expect(SamplingService.resolveMaxTokens('high', '1536x1024')).toBe(350);
    });

    it('should return 350 tokens for high quality + portrait large canvas', () => {
      expect(SamplingService.resolveMaxTokens('high', '1024x1536')).toBe(350);
    });

    it('should return 350 tokens for hd quality + large canvas', () => {
      expect(SamplingService.resolveMaxTokens('hd', '1792x1024')).toBe(350);
    });

    it('should return 350 for quality=hd with size=1536x1024', () => {
      expect(SamplingService.resolveMaxTokens('hd', '1536x1024')).toBe(350);
    });

    it('should return 250 tokens for high quality + standard canvas', () => {
      expect(SamplingService.resolveMaxTokens('high', '1024x1024')).toBe(250);
    });

    it('should return 250 tokens for high quality + auto size', () => {
      expect(SamplingService.resolveMaxTokens('high', 'auto')).toBe(250);
    });

    it('should return 150 tokens for medium quality', () => {
      expect(SamplingService.resolveMaxTokens('medium')).toBe(150);
    });

    it('should return 150 tokens for auto quality', () => {
      expect(SamplingService.resolveMaxTokens('auto')).toBe(150);
    });

    it('should return 150 tokens for standard quality', () => {
      expect(SamplingService.resolveMaxTokens('standard')).toBe(150);
    });

    it('should return 150 tokens when quality is undefined', () => {
      expect(SamplingService.resolveMaxTokens(undefined)).toBe(150);
    });

    it('should return 150 tokens when both quality and size are undefined', () => {
      expect(SamplingService.resolveMaxTokens()).toBe(150);
    });
  });

  // ── buildUserMessage() — always-present content ──────────────────────────
  describe('buildUserMessage() — base content', () => {
    it('should include the model name', () => {
      const msg = SamplingService.buildUserMessage('a cat', { model: 'gpt-image-2' });
      expect(msg).toContain('gpt-image-2');
    });

    it('should include the original prompt quoted', () => {
      const msg = SamplingService.buildUserMessage('a red barn', { model: 'gpt-image-2' });
      expect(msg).toContain('"a red barn"');
    });

    it('should always include anti-pattern instructions', () => {
      const msg = SamplingService.buildUserMessage('test', { model: 'gpt-image-2' });
      expect(msg).toContain('AVOID');
      expect(msg).toContain('"beautiful"');
    });

    it('always ends with the original prompt', () => {
      const original = 'a stormy ocean at night';
      const msg = SamplingService.buildUserMessage(original, { model: 'gpt-image-2' });
      const lastLine = msg.trimEnd().split('\n').pop()!;
      expect(lastLine).toContain(original);
    });
  });

  // ── buildUserMessage() — quality-driven fidelity directives ─────────────
  describe('buildUserMessage() — quality/fidelity directive', () => {
    it('should include draft directive for quality=low', () => {
      const msg = SamplingService.buildUserMessage('a cat', { model: 'gpt-image-2', quality: 'low' });
      expect(msg).toContain('Draft');
      expect(msg).toContain('SHORT');
    });

    it('should include maximum fidelity directive for quality=high', () => {
      const msg = SamplingService.buildUserMessage('a cat', { model: 'gpt-image-2', quality: 'high' });
      expect(msg).toContain('Maximum');
      expect(msg).toContain('FIDELITY');
    });

    it('should include maximum fidelity directive for quality=hd', () => {
      const msg = SamplingService.buildUserMessage('a cat', { model: 'gpt-image-2', quality: 'hd' });
      expect(msg).toContain('Maximum');
    });

    it('should include standard fidelity directive for quality=medium', () => {
      const msg = SamplingService.buildUserMessage('a cat', { model: 'gpt-image-2', quality: 'medium' });
      expect(msg).toContain('Standard');
    });

    it('should include standard fidelity directive for quality=auto', () => {
      const msg = SamplingService.buildUserMessage('a cat', { model: 'gpt-image-2', quality: 'auto' });
      expect(msg).toContain('Standard');
    });

    it('should include standard fidelity directive when quality is undefined', () => {
      const msg = SamplingService.buildUserMessage('a cat', { model: 'gpt-image-2' });
      expect(msg).toContain('Standard');
    });

    it('should mention lighting in high-fidelity directive', () => {
      const msg = SamplingService.buildUserMessage('a cat', { model: 'gpt-image-2', quality: 'high' });
      expect(msg).toContain('Lighting');
    });
  });

  // ── buildUserMessage() — canvas / size directives ────────────────────────
  describe('buildUserMessage() — canvas directive', () => {
    it('should include widescreen directive for size=1536x1024', () => {
      const msg = SamplingService.buildUserMessage('a landscape', {
        model: 'gpt-image-2',
        size: '1536x1024',
      });
      expect(msg).toContain('CANVAS');
      expect(msg).toContain('Widescreen');
    });

    it('should include widescreen directive for size=1792x1024', () => {
      const msg = SamplingService.buildUserMessage('a landscape', {
        model: 'gpt-image-2',
        size: '1792x1024',
      });
      expect(msg).toContain('Widescreen');
    });

    it('should include ultra-wide cinematic directive for size=2560x1440', () => {
      const msg = SamplingService.buildUserMessage('a landscape', {
        model: 'gpt-image-2',
        size: '2560x1440',
      });
      expect(msg).toContain('Ultra-wide');
      expect(msg).toContain('cinematic');
    });

    it('should include portrait directive for size=1024x1536', () => {
      const msg = SamplingService.buildUserMessage('a portrait', {
        model: 'gpt-image-2',
        size: '1024x1536',
      });
      expect(msg).toContain('Portrait');
      expect(msg).toContain('vertical');
    });

    it('should include portrait directive for size=1024x1792', () => {
      const msg = SamplingService.buildUserMessage('a portrait', {
        model: 'gpt-image-2',
        size: '1024x1792',
      });
      expect(msg).toContain('Portrait');
    });

    it('should include square directive for size=1024x1024', () => {
      const msg = SamplingService.buildUserMessage('a logo', {
        model: 'gpt-image-2',
        size: '1024x1024',
      });
      expect(msg).toContain('Square');
      expect(msg).toContain('symmetrical');
    });

    it('should NOT include canvas section for size=auto', () => {
      const msg = SamplingService.buildUserMessage('a cat', {
        model: 'gpt-image-2',
        size: 'auto',
      });
      expect(msg).not.toContain('CANVAS');
    });

    it('should NOT include canvas section when size is undefined', () => {
      const msg = SamplingService.buildUserMessage('a cat', { model: 'gpt-image-2' });
      expect(msg).not.toContain('CANVAS');
    });
  });

  // ── buildUserMessage() — transparent background override ────────────────
  describe('buildUserMessage() — transparent background', () => {
    it('should include isolated-subject directive for transparent background', () => {
      const msg = SamplingService.buildUserMessage('a logo', {
        model: 'gpt-image-2',
        background: 'transparent',
      });
      expect(msg).toContain('Transparent background');
      expect(msg).toContain('isolated subject');
    });

    it('should instruct to omit background/scene description for transparent background', () => {
      const msg = SamplingService.buildUserMessage('a product', {
        model: 'gpt-image-2',
        background: 'transparent',
      });
      expect(msg).toContain('Do NOT mention any background');
    });

    it('should NOT include transparent background directive for opaque background', () => {
      const msg = SamplingService.buildUserMessage('a cat', {
        model: 'gpt-image-2',
        background: 'opaque',
      });
      expect(msg).not.toContain('Transparent background');
    });

    it('should NOT include transparent background directive for auto background', () => {
      const msg = SamplingService.buildUserMessage('a cat', {
        model: 'gpt-image-2',
        background: 'auto',
      });
      expect(msg).not.toContain('Transparent background');
    });
  });

  // ── buildUserMessage() — JPEG colour note ───────────────────────────────
  describe('buildUserMessage() — JPEG format note', () => {
    it('should include JPEG colour guidance for output_format=jpeg', () => {
      const msg = SamplingService.buildUserMessage('a sunset', {
        model: 'gpt-image-2',
        output_format: 'jpeg',
      });
      expect(msg).toContain('JPEG');
      expect(msg).toContain('colour');
    });

    it('should NOT include JPEG note for output_format=png', () => {
      const msg = SamplingService.buildUserMessage('a cat', {
        model: 'gpt-image-2',
        output_format: 'png',
      });
      expect(msg).not.toContain('FORMAT: JPEG');
    });

    it('should NOT include JPEG note for output_format=webp', () => {
      const msg = SamplingService.buildUserMessage('a cat', {
        model: 'gpt-image-2',
        output_format: 'webp',
      });
      expect(msg).not.toContain('FORMAT: JPEG');
    });

    it('should NOT show JPEG note when background=transparent (PNG cutout takes priority)', () => {
      const msg = SamplingService.buildUserMessage('a logo', {
        model: 'gpt-image-2',
        output_format: 'jpeg',
        background: 'transparent',
      });
      // transparent section takes over — JPEG colour note not shown
      expect(msg).not.toContain('FORMAT: JPEG');
    });
  });

  // ── buildUserMessage() — multi-variant guidance ──────────────────────────
  describe('buildUserMessage() — variant guidance', () => {
    it('should include variant guidance when n > 1', () => {
      const msg = SamplingService.buildUserMessage('a cat', {
        model: 'gpt-image-2',
        n: 4,
      });
      expect(msg).toContain('VARIANTS');
      expect(msg).toContain('4 images');
    });

    it('should include the exact count in variant guidance', () => {
      const msg = SamplingService.buildUserMessage('a cat', {
        model: 'gpt-image-2',
        n: 7,
      });
      expect(msg).toContain('7 images');
    });

    it('should NOT include variant guidance when n = 1', () => {
      const msg = SamplingService.buildUserMessage('a cat', {
        model: 'gpt-image-2',
        n: 1,
      });
      expect(msg).not.toContain('VARIANTS');
    });

    it('should NOT include variant guidance when n is undefined (defaults to 1)', () => {
      const msg = SamplingService.buildUserMessage('a cat', { model: 'gpt-image-2' });
      expect(msg).not.toContain('VARIANTS');
    });

    it('should include open-ended variation advice when n > 1', () => {
      const msg = SamplingService.buildUserMessage('a cat', {
        model: 'gpt-image-2',
        n: 3,
      });
      expect(msg).toContain('natural variation');
    });
  });

  // ── SYSTEM_PROMPT content ────────────────────────────────────────────────
  describe('SYSTEM_PROMPT', () => {
    it('should instruct the LLM to return ONLY the enhanced prompt', () => {
      expect(SamplingService.SYSTEM_PROMPT).toContain('Return ONLY the enhanced prompt text');
    });

    it('should prohibit adding explanations or labels', () => {
      expect(SamplingService.SYSTEM_PROMPT).toContain('No explanations');
    });

    it('should require preserving the original intent', () => {
      expect(SamplingService.SYSTEM_PROMPT).toContain('intent');
    });

    it('should prohibit hollow filler adjectives', () => {
      expect(SamplingService.SYSTEM_PROMPT).toContain('beautiful');
      expect(SamplingService.SYSTEM_PROMPT).toContain('masterpiece');
    });

    it('should instruct to append no-watermark constraint', () => {
      expect(SamplingService.SYSTEM_PROMPT).toContain('no watermark');
    });

    it('should mention photorealism trigger guidance', () => {
      expect(SamplingService.SYSTEM_PROMPT).toContain('photorealistic');
    });
  });

  // ── combined scenario tests ──────────────────────────────────────────────
  describe('buildUserMessage() — combined scenarios', () => {
    it('high quality + widescreen = detailed content AND canvas cues both present', () => {
      const msg = SamplingService.buildUserMessage('mountain range', {
        model: 'gpt-image-2',
        quality: 'high',
        size: '1536x1024',
      });
      expect(msg).toContain('Maximum');
      expect(msg).toContain('Widescreen');
    });

    it('low quality + transparent = draft AND isolated-subject both present', () => {
      const msg = SamplingService.buildUserMessage('company logo', {
        model: 'gpt-image-2',
        quality: 'low',
        background: 'transparent',
      });
      expect(msg).toContain('Draft');
      expect(msg).toContain('isolated subject');
    });

    it('high quality + transparent + n=3 = all three sections present', () => {
      const msg = SamplingService.buildUserMessage('product icon', {
        model: 'gpt-image-2',
        quality: 'high',
        background: 'transparent',
        n: 3,
      });
      expect(msg).toContain('Maximum');
      expect(msg).toContain('isolated subject');
      expect(msg).toContain('VARIANTS');
    });

    it('resolveMaxTokens should return 80 for low quality + large canvas', () => {
      // Draft wins over canvas size — user wants speed, not detail
      expect(SamplingService.resolveMaxTokens('low', '1536x1024')).toBe(80);
    });
  });
});
