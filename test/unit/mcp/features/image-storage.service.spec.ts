import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ImageStorageService, imageMimeType, pathToFileUri } from '../../../../src/mcp/features/image-storage.service';

describe('ImageStorageService', () => {
  let tmpDir: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-storage-test-'));
    process.env['IMAGE_OUTPUT_DIR'] = tmpDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('honors IMAGE_OUTPUT_DIR and persists decoded image bytes', async () => {
    const service = new ImageStorageService();
    const saved = await service.saveImage(Buffer.from('image-data').toString('base64'), 'png');
    expect(path.dirname(saved)).toBe(tmpDir);
    expect(saved.endsWith('.png')).toBe(true);
    expect(await fs.readFile(saved, 'utf8')).toBe('image-data');
  });

  it('strips a data URI prefix', async () => {
    const service = new ImageStorageService();
    const saved = await service.saveImage(`data:image/webp;base64,${Buffer.from('webp').toString('base64')}`, 'webp');
    expect(await fs.readFile(saved, 'utf8')).toBe('webp');
  });

  it('reads the freedesktop XDG_PICTURES_DIR and appends the application directory on Linux', async () => {
    if (process.platform !== 'linux') return;
    delete process.env['IMAGE_OUTPUT_DIR'];
    process.env['XDG_CONFIG_HOME'] = tmpDir;
    await fs.writeFile(path.join(tmpDir, 'user-dirs.dirs'), 'XDG_PICTURES_DIR="$HOME/Images"\n');
    const service = new ImageStorageService();
    expect(await service.getOutputDirectory()).toBe(path.join(os.homedir(), 'Images', 'gpt-image-mcp'));
  });

  it('encodes file paths as file URIs', () => {
    expect(pathToFileUri('/tmp/My Image.png')).toBe('file:///tmp/My%20Image.png');
  });

  it('maps jpeg to the standard MIME type', () => {
    expect(imageMimeType('jpeg')).toBe('image/jpeg');
    expect(imageMimeType('png')).toBe('image/png');
  });
});
