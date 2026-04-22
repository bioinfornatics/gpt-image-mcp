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

    it('should return original prompt when server.request throws', async () => {
      const svc = await makeService(true);
      const mockServer = { request: jest.fn().mockRejectedValue(new Error('not supported')) };
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', 'gpt-image-1');
      expect(result).toBe('a cat');
    });

    it('should return enhanced prompt when sampling succeeds', async () => {
      const svc = await makeService(true);
      const enhanced = 'A fluffy orange tabby cat sitting on a sun-drenched windowsill, photorealistic, 8K';
      const mockServer = {
        request: jest.fn().mockResolvedValue({
          content: { type: 'text', text: enhanced },
        }),
      };
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', 'gpt-image-1');
      expect(result).toBe(enhanced);
    });

    it('should return original prompt when sampling response has no text', async () => {
      const svc = await makeService(true);
      const mockServer = {
        request: jest.fn().mockResolvedValue({ content: { type: 'image' } }),
      };
      const result = await svc.enhancePrompt(mockServer as any, 'a cat', 'gpt-image-1');
      expect(result).toBe('a cat');
    });

    it('should send sampling/createMessage method to server', async () => {
      const svc = await makeService(true);
      const mockServer = {
        request: jest.fn().mockResolvedValue({
          content: { type: 'text', text: 'enhanced prompt' },
        }),
      };
      await svc.enhancePrompt(mockServer as any, 'a cat', 'gpt-image-1');
      expect(mockServer.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'sampling/createMessage' }),
        expect.anything(),
      );
    });

    it('should include original prompt in sampling request', async () => {
      const svc = await makeService(true);
      let capturedRequest: any = null;
      const mockServer = {
        request: jest.fn().mockImplementation((req: any) => {
          capturedRequest = req;
          return Promise.resolve({ content: { type: 'text', text: 'enhanced' } });
        }),
      };
      await svc.enhancePrompt(mockServer as any, 'my original prompt', 'gpt-image-1');
      const messages = capturedRequest?.params?.messages ?? [];
      const content = messages.map((m: any) => m.content?.text ?? '').join(' ');
      expect(content).toContain('my original prompt');
    });
  });
});
