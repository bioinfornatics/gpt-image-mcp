import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { RootsService } from '../../../../src/mcp/features/roots.service';

describe('RootsService', () => {
  let service: RootsService;

  beforeEach(() => {
    service = new RootsService();
  });

  describe('getRoots()', () => {
    it('should return empty array when server.listRoots throws', async () => {
      const mockServer = { listRoots: jest.fn().mockRejectedValue(new Error('no roots cap')) };
      const roots = await service.getRoots(mockServer as any);
      expect(roots).toEqual([]);
    });

    it('should return roots from server response', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: 'file:///home/user/project', name: 'my-project' }],
        }),
      };
      const roots = await service.getRoots(mockServer as any);
      expect(roots).toHaveLength(1);
      expect(roots[0].uri).toBe('file:///home/user/project');
    });

    it('should call server.listRoots (not server.request)', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({ roots: [] }),
        request: jest.fn(),
      };
      await service.getRoots(mockServer as any);
      expect(mockServer.listRoots).toHaveBeenCalledTimes(1);
      expect(mockServer.request).not.toHaveBeenCalled();
    });

    it('should return empty array when roots list is empty', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({ roots: [] }),
      };
      const roots = await service.getRoots(mockServer as any);
      expect(roots).toEqual([]);
    });
  });

  describe('saveImageToWorkspace()', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should return null when no roots are available', async () => {
      const mockServer = { listRoots: jest.fn().mockRejectedValue(new Error('no cap')) };
      const result = await service.saveImageToWorkspace(mockServer as any, 'ZmFrZQ==');
      expect(result).toBeNull();
    });

    it('should save image file and return the path', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: `file://${tmpDir}`, name: 'test' }],
        }),
      };
      const b64 = Buffer.from('fake-image-data').toString('base64');
      const filePath = await service.saveImageToWorkspace(mockServer as any, b64, 'png');
      expect(filePath).not.toBeNull();
      expect(filePath!.endsWith('.png')).toBe(true);
      // Verify file actually exists
      const stat = await fs.stat(filePath!);
      expect(stat.isFile()).toBe(true);
    });

    it('should create the generated/ subdirectory', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({
          roots: [{ uri: `file://${tmpDir}`, name: 'test' }],
        }),
      };
      const b64 = Buffer.from('x').toString('base64');
      await service.saveImageToWorkspace(mockServer as any, b64);
      const genDir = path.join(tmpDir, 'generated');
      const stat = await fs.stat(genDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should use server.listRoots (not server.request) when saving', async () => {
      const mockServer = {
        listRoots: jest.fn().mockResolvedValue({ roots: [] }),
        request: jest.fn(),
      };
      await service.saveImageToWorkspace(mockServer as any, 'ZmFrZQ==');
      expect(mockServer.listRoots).toHaveBeenCalledTimes(1);
      expect(mockServer.request).not.toHaveBeenCalled();
    });
  });
});
