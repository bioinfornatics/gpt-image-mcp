import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SamplingService } from '../../../../src/mcp/features/sampling.service';

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

describe('SamplingService', () => {
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

  describe('enhancePrompt()', () => {
    it('should return original prompt when disabled', async () => {
      const svc = await makeService(false);
      const result = await svc.enhancePrompt({} as any, 'a cat', 'gpt-image-1');
      expect(result).toBe('a cat');
    });

    it('should return original prompt when server.createMessage throws', async () => {
      const svc = await makeService(true);
      const mockServer = { createMessage: jest.fn().mockRejectedValue(new Error('not supported')) };
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', 'gpt-image-1');
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
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', 'gpt-image-1');
      expect(result).toBe(enhanced);
    });

    it('should return original prompt when sampling response has no text', async () => {
      const svc = await makeService(true);
      const mockServer = {
        createMessage: jest.fn().mockResolvedValue({ content: { type: 'image' } }),
      };
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', 'gpt-image-1');
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
      await svc.enhancePrompt(mockServer as any, 'a cat', 'gpt-image-1');
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
      await svc.enhancePrompt(mockServer as any, 'my original prompt', 'gpt-image-1');
      const messages = capturedParams?.messages ?? [];
      const content = messages.map((m: any) => m.content?.text ?? '').join(' ');
      expect(content).toContain('my original prompt');
    });

    it('should sanitise LLM response containing null bytes', async () => {
      const svc = await makeService(true);
      const malicious = 'enhanced prompt\0with null byte';
      const mockServer = {
        createMessage: jest.fn().mockResolvedValue({
          content: { type: 'text', text: malicious },
        }),
      };
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', 'gpt-image-1');
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
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', 'gpt-image-1');
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
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', 'gpt-image-1');
      expect(result).not.toContain('\u202E');
      expect(result).toBe('enhancedprompt');
    });
  });
});
