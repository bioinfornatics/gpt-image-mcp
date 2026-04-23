import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { RootsService } from '../../../../src/mcp/features/roots.service';

// Helper: create a RootsService with an optional WORKSPACE_ALLOWED_ROOTS override
function makeService(allowedRoots?: string): RootsService {
  const orig = process.env['WORKSPACE_ALLOWED_ROOTS'];
  if (allowedRoots !== undefined) {
    process.env['WORKSPACE_ALLOWED_ROOTS'] = allowedRoots;
  } else {
    delete process.env['WORKSPACE_ALLOWED_ROOTS'];
  }
  const svc = new RootsService();
  if (orig !== undefined) process.env['WORKSPACE_ALLOWED_ROOTS'] = orig;
  else delete process.env['WORKSPACE_ALLOWED_ROOTS'];
  return svc;
}

describe('RootsService', () => {
  let service: RootsService;
  let tmpDir: string;

  beforeEach(async () => {
    service = makeService(); // no allowlist → accept all
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-roots-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── getRoots() ─────────────────────────────────────────────────────────

  describe('getRoots()', () => {
    it('should return empty array when server.listRoots throws', async () => {
      const mockServer = { listRoots: jest.fn().mockRejectedValue(new Error('no roots cap')) };
      expect(await service.getRoots(mockServer as any)).toEqual([]);
    });

    it('should return roots from server response', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: 'file:///home/user/project', name: 'project' }],
        }),
      };
      const roots = await service.getRoots(mockServer as any);
      expect(roots).toHaveLength(1);
      expect(roots[0].uri).toBe('file:///home/user/project');
    });

    it('should call server.listRoots not server.request (SDK v1.29 named method)', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({ roots: [] }),
        request: jest.fn(),
      };
      await service.getRoots(mockServer as any);
      expect(mockServer.listRoots).toHaveBeenCalledTimes(1);
      expect(mockServer.request).not.toHaveBeenCalled();
    });

    it('should return empty array when roots list is empty', async () => {
      const mockServer = { listRoots: jest.fn().mockResolvedValue({ roots: [] }) };
      expect(await service.getRoots(mockServer as any)).toEqual([]);
    });
  });

  // ─── saveImageToWorkspace() — happy paths ────────────────────────────────

  describe('saveImageToWorkspace() — happy paths', () => {
    it('should return null when no roots available', async () => {
      const mockServer = { listRoots: jest.fn().mockRejectedValue(new Error('no cap')) };
      expect(await service.saveImageToWorkspace(mockServer as any, 'ZmFrZQ==')).toBeNull();
    });

    it('should save PNG and return absolute path', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: `file://${tmpDir}` }],
        }),
      };
      const b64 = Buffer.from('fake-png-data').toString('base64');
      const filePath = await service.saveImageToWorkspace(mockServer as any, b64, 'png');
      expect(filePath).not.toBeNull();
      expect(filePath!.endsWith('.png')).toBe(true);
      expect((await fs.stat(filePath!)).isFile()).toBe(true);
    });

    it('should create generated/ subdirectory', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: `file://${tmpDir}` }],
        }),
      };
      await service.saveImageToWorkspace(mockServer as any, 'ZmFrZQ==');
      expect((await fs.stat(path.join(tmpDir, 'generated'))).isDirectory()).toBe(true);
    });

    it('should strip data URI prefix from base64 input', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: `file://${tmpDir}` }],
        }),
      };
      const raw = 'hello world';
      const b64WithPrefix = `data:image/png;base64,${Buffer.from(raw).toString('base64')}`;
      const filePath = await service.saveImageToWorkspace(mockServer as any, b64WithPrefix, 'png');
      expect(filePath).not.toBeNull();
      const content = await fs.readFile(filePath!);
      expect(content.toString()).toBe(raw);
    });

    it('should handle file://localhost/path URI', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: `file://localhost${tmpDir}` }],
        }),
      };
      const filePath = await service.saveImageToWorkspace(
        mockServer as any,
        Buffer.from('x').toString('base64'),
        'webp',
      );
      expect(filePath).not.toBeNull();
      expect(filePath!.endsWith('.webp')).toBe(true);
    });

    it('should use server.listRoots not server.request when saving', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({ roots: [] }),
        request: jest.fn(),
      };
      await service.saveImageToWorkspace(mockServer as any, 'ZmFrZQ==');
      expect(mockServer.listRoots).toHaveBeenCalledTimes(1);
      expect(mockServer.request).not.toHaveBeenCalled();
    });
  });

  // ─── H6: allowlist enforcement ────────────────────────────────────────────

  describe('saveImageToWorkspace() — allowlist (H6)', () => {
    it('should accept all roots when WORKSPACE_ALLOWED_ROOTS is not set', async () => {
      // makeService() called with no args → no allowlist → any path allowed
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: `file://${tmpDir}` }],
        }),
      };
      const filePath = await service.saveImageToWorkspace(
        mockServer as any,
        Buffer.from('x').toString('base64'),
      );
      expect(filePath).not.toBeNull();
    });

    it('should accept a root that matches the allowlist prefix', async () => {
      const svc = makeService(tmpDir); // allowlist = only tmpDir
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: `file://${tmpDir}` }],
        }),
      };
      const filePath = await svc.saveImageToWorkspace(
        mockServer as any,
        Buffer.from('x').toString('base64'),
      );
      expect(filePath).not.toBeNull();
    });

    it('should reject a root outside the allowlist', async () => {
      const svc = makeService('/home/trusted'); // only /home/trusted allowed
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: `file:///etc` }], // ← attacker-supplied root
        }),
      };
      const filePath = await svc.saveImageToWorkspace(
        mockServer as any,
        Buffer.from('x').toString('base64'),
      );
      expect(filePath).toBeNull();
    });

    it('should reject /etc even if /etc/trusted is in allowlist', async () => {
      const svc = makeService('/etc/trusted');
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: 'file:///etc' }], // traversal attempt
        }),
      };
      const filePath = await svc.saveImageToWorkspace(
        mockServer as any,
        Buffer.from('x').toString('base64'),
      );
      expect(filePath).toBeNull();
    });

    it('should try next root when first is blocked by allowlist', async () => {
      const svc = makeService(tmpDir); // only tmpDir allowed
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [
            { uri: 'file:///etc' },          // ← rejected
            { uri: `file://${tmpDir}` },      // ← accepted
          ],
        }),
      };
      const filePath = await svc.saveImageToWorkspace(
        mockServer as any,
        Buffer.from('x').toString('base64'),
      );
      expect(filePath).not.toBeNull();
      expect(filePath!.startsWith(tmpDir)).toBe(true);
    });

    it('should reject non-file:// URIs (http, smb, etc.)', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: 'http://attacker.example.com/share' }],
        }),
      };
      const filePath = await service.saveImageToWorkspace(
        mockServer as any,
        Buffer.from('x').toString('base64'),
      );
      expect(filePath).toBeNull();
    });
  });
});
