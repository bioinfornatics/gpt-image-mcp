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
    it('should return null when disabled', async () => {
      const svc = await makeService(false);
      const result = await svc.requestImageParams(
        {} as any,
        { hasQuality: false, hasSize: false, hasStyle: false },
      );
      expect(result).toBeNull();
    });

    it('should return null when all params already provided', async () => {
      const svc = await makeService(true);
      const result = await svc.requestImageParams(
        {} as any,
        { hasQuality: true, hasSize: true, hasStyle: true },
      );
      expect(result).toBeNull();
    });

    it('should return null when server.elicitInput throws (client has no elicitation cap)', async () => {
      const svc = await makeService(true);
      const mockServer = { elicitInput: jest.fn().mockRejectedValue(new Error('not supported')) };
      const result = await svc.requestImageParams(
        mockServer as any,
        { hasQuality: false, hasSize: false, hasStyle: false },
      );
      expect(result).toBeNull();
    });

    it('should return content when client accepts elicitation', async () => {
      const svc = await makeService(true);
      const mockServer = {
        elicitInput: jest.fn().mockResolvedValue({
          action: 'accept',
          content: { quality: 'high', size: '1024x1024' },
        }),
      };
      const result = await svc.requestImageParams(
        mockServer as any,
        { hasQuality: false, hasSize: false, hasStyle: false },
      );
      expect(result).toEqual({ quality: 'high', size: '1024x1024' });
    });

    it('should return null when client declines', async () => {
      const svc = await makeService(true);
      const mockServer = {
        elicitInput: jest.fn().mockResolvedValue({ action: 'decline' }),
      };
      const result = await svc.requestImageParams(
        mockServer as any,
        { hasQuality: false, hasSize: false, hasStyle: false },
      );
      expect(result).toBeNull();
    });

    it('should return null when client cancels', async () => {
      const svc = await makeService(true);
      const mockServer = {
        elicitInput: jest.fn().mockResolvedValue({ action: 'cancel' }),
      };
      const result = await svc.requestImageParams(
        mockServer as any,
        { hasQuality: false, hasSize: false, hasStyle: false },
      );
      expect(result).toBeNull();
    });

    it('should NEVER include password/secret fields in elicitation schema', async () => {
      const svc = await makeService(true);
      let capturedParams: any = null;
      const mockServer = {
        elicitInput: jest.fn().mockImplementation((params: any) => {
          capturedParams = params;
          return Promise.resolve({ action: 'decline' });
        }),
      };
      await svc.requestImageParams(
        mockServer as any,
        { hasQuality: false, hasSize: false, hasStyle: false },
      );
      const props = capturedParams?.requestedSchema?.properties ?? {};
      const fieldNames = Object.keys(props).join(' ').toLowerCase();
      expect(fieldNames).not.toMatch(/password|secret|key|token|credential/);
    });

    it('should call server.elicitInput (not server.request)', async () => {
      const svc = await makeService(true);
      const mockServer = {
        elicitInput: jest.fn().mockResolvedValue({ action: 'accept', content: {} }),
        request: jest.fn(),
      };
      await svc.requestImageParams(
        mockServer as any,
        { hasQuality: false, hasSize: false, hasStyle: false },
      );
      expect(mockServer.elicitInput).toHaveBeenCalledTimes(1);
      expect(mockServer.request).not.toHaveBeenCalled();
    });
  });
});
