import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ElicitationService } from '../../../../src/mcp/features/elicitation.service';

function makeService(useElicitation: boolean) {
  return Test.createTestingModule({
    providers: [
      ElicitationService,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) => {
            if (key === 'mcp') return { useElicitation };
            return undefined;
          },
        },
      },
    ],
  })
    .compile()
    .then((m) => m.get(ElicitationService));
}

/** Minimal params with sensible defaults for brevity */
function p(overrides: Partial<{ hasQuality: boolean; hasSize: boolean; model: string }> = {}) {
  return { hasQuality: false, hasSize: false, model: 'gpt-image-2', ...overrides };
}

describe('ElicitationService', () => {
  describe('isEnabled', () => {
    it('should be true when USE_ELICITATION=true', async () => {
      const svc = await makeService(true);
      expect(svc.isEnabled).toBe(true);
    });

    it('should be false when USE_ELICITATION=false', async () => {
      const svc = await makeService(false);
      expect(svc.isEnabled).toBe(false);
    });
  });

  describe('requestImageParams()', () => {
    // ── disabled ────────────────────────────────────────────────────────────

    it('should return null when disabled', async () => {
      const svc = await makeService(false);
      expect(await svc.requestImageParams({} as any, p())).toBeNull();
    });

    // ── nothing to elicit ────────────────────────────────────────────────────

    it('should return null when both quality and size are already set', async () => {
      const svc = await makeService(true);
      expect(await svc.requestImageParams({} as any, p({ hasQuality: true, hasSize: true }))).toBeNull();
    });

    it('should still elicit size when only quality is set', async () => {
      const svc = await makeService(true);
      const mockServer = {
        elicitInput: jest.fn().mockResolvedValue({ action: 'decline' }),
      };
      await svc.requestImageParams(mockServer as any, p({ hasQuality: true, hasSize: false }));
      const props = mockServer.elicitInput.mock.calls[0][0].requestedSchema.properties;
      expect(props).not.toHaveProperty('quality');
      expect(props).toHaveProperty('size');
    });

    it('should still elicit quality when only size is set', async () => {
      const svc = await makeService(true);
      const mockServer = {
        elicitInput: jest.fn().mockResolvedValue({ action: 'decline' }),
      };
      await svc.requestImageParams(mockServer as any, p({ hasQuality: false, hasSize: true }));
      const props = mockServer.elicitInput.mock.calls[0][0].requestedSchema.properties;
      expect(props).toHaveProperty('quality');
      expect(props).not.toHaveProperty('size');
    });

    // ── client responses ─────────────────────────────────────────────────────

    it('should return null when server.elicitInput throws (client has no elicitation cap)', async () => {
      const svc = await makeService(true);
      const mockServer = { elicitInput: jest.fn().mockRejectedValue(new Error('not supported')) };
      expect(await svc.requestImageParams(mockServer as any, p())).toBeNull();
    });

    it('should return content when client accepts', async () => {
      const svc = await makeService(true);
      const mockServer = {
        elicitInput: jest.fn().mockResolvedValue({
          action: 'accept',
          content: { quality: 'high', size: '1024x1024' },
        }),
      };
      expect(await svc.requestImageParams(mockServer as any, p()))
        .toEqual({ quality: 'high', size: '1024x1024' });
    });

    it('should return null when client declines', async () => {
      const svc = await makeService(true);
      const mockServer = { elicitInput: jest.fn().mockResolvedValue({ action: 'decline' }) };
      expect(await svc.requestImageParams(mockServer as any, p())).toBeNull();
    });

    it('should return null when client cancels', async () => {
      const svc = await makeService(true);
      const mockServer = { elicitInput: jest.fn().mockResolvedValue({ action: 'cancel' }) };
      expect(await svc.requestImageParams(mockServer as any, p())).toBeNull();
    });

    // ── model-aware size enum (Issue D fix) ──────────────────────────────────

    it('should include 2048x2048 and 4096x4096 in size options for gpt-image-2', async () => {
      const svc = await makeService(true);
      let captured: any;
      const mockServer = {
        elicitInput: jest.fn().mockImplementation((params: any) => {
          captured = params;
          return Promise.resolve({ action: 'decline' });
        }),
      };
      await svc.requestImageParams(mockServer as any, p({ model: 'gpt-image-2' }));
      const sizeEnum = captured.requestedSchema.properties.size.enum as string[];
      expect(sizeEnum).toContain('2048x2048');
      expect(sizeEnum).toContain('4096x4096');
    });

    it('should NOT include 4K sizes for gpt-image-1.x models', async () => {
      const svc = await makeService(true);
      let captured: any;
      const mockServer = {
        elicitInput: jest.fn().mockImplementation((params: any) => {
          captured = params;
          return Promise.resolve({ action: 'decline' });
        }),
      };
      await svc.requestImageParams(mockServer as any, p({ model: 'gpt-image-1' }));
      const sizeEnum = captured.requestedSchema.properties.size.enum as string[];
      expect(sizeEnum).not.toContain('4096x4096');
      expect(sizeEnum).not.toContain('2048x2048');
      expect(sizeEnum).toContain('1024x1024');
    });

    it('should NOT include 4K sizes for gpt-image-1.5', async () => {
      const svc = await makeService(true);
      let captured: any;
      const mockServer = {
        elicitInput: jest.fn().mockImplementation((params: any) => {
          captured = params;
          return Promise.resolve({ action: 'decline' });
        }),
      };
      await svc.requestImageParams(mockServer as any, p({ model: 'gpt-image-1.5' }));
      const sizeEnum = captured.requestedSchema.properties.size.enum as string[];
      expect(sizeEnum).not.toContain('4096x4096');
    });

    // ── hasStyle removed (Issue A fix) ───────────────────────────────────────

    it('should NOT have a style field in the elicitation schema (style not supported by gpt-image-*)', async () => {
      const svc = await makeService(true);
      let captured: any;
      const mockServer = {
        elicitInput: jest.fn().mockImplementation((params: any) => {
          captured = params;
          return Promise.resolve({ action: 'decline' });
        }),
      };
      await svc.requestImageParams(mockServer as any, p());
      const props = captured.requestedSchema.properties;
      expect(props).not.toHaveProperty('style');
    });

    // ── security ─────────────────────────────────────────────────────────────

    it('should NEVER include password/secret fields in elicitation schema', async () => {
      const svc = await makeService(true);
      let captured: any;
      const mockServer = {
        elicitInput: jest.fn().mockImplementation((params: any) => {
          captured = params;
          return Promise.resolve({ action: 'decline' });
        }),
      };
      await svc.requestImageParams(mockServer as any, p());
      const fieldNames = Object.keys(captured?.requestedSchema?.properties ?? {}).join(' ').toLowerCase();
      expect(fieldNames).not.toMatch(/password|secret|key|token|credential/);
    });

    // ── SDK method used (Issue C fix) ────────────────────────────────────────

    it('should call server.elicitInput directly (no server.request fallback)', async () => {
      const svc = await makeService(true);
      const mockServer = {
        elicitInput: jest.fn().mockResolvedValue({ action: 'accept', content: {} }),
        request: jest.fn(),
      };
      await svc.requestImageParams(mockServer as any, p());
      expect(mockServer.elicitInput).toHaveBeenCalledTimes(1);
      expect(mockServer.request).not.toHaveBeenCalled();
    });
  });
});
