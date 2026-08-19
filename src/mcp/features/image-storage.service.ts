import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getXdgPaths } from '../../config/xdg-paths';
import { decodeImageData, type ImageFormat } from '../../providers/image-media';
export type { ImageFormat } from '../../providers/image-media';

@Injectable()
export class ImageStorageService {
  private readonly logger = new Logger(ImageStorageService.name);

  async saveImage(b64Data: string, _requestedFormat?: ImageFormat): Promise<string> {
    const decoded = decodeImageData(b64Data);
    const outputDir = await this.getOutputDirectory();
    await fs.mkdir(outputDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = Math.random().toString(36).slice(2, 8);
    const filePath = path.join(outputDir, `img_${timestamp}_${suffix}.${decoded.format}`);
    await fs.writeFile(filePath, decoded.bytes, { mode: 0o600 });
    this.logger.log(`Image saved: ${filePath}`);
    return filePath;
  }

  async getOutputDirectory(): Promise<string> {
    if (process.env['IMAGE_OUTPUT_DIR']) {
      return path.resolve(this.expandHome(process.env['IMAGE_OUTPUT_DIR']));
    }
    const pictures = process.platform === 'linux'
      ? await this.getLinuxPicturesDirectory()
      : process.platform === 'darwin'
        ? path.join(os.homedir(), 'Pictures')
        : this.getWindowsPicturesDirectory();
    return path.join(pictures, 'gpt-image-mcp');
  }

  private async getLinuxPicturesDirectory(): Promise<string> {
    const configured = await this.readFreedesktopPicturesDirectory();
    return configured ?? path.join(os.homedir(), 'Images');
  }

  private async readFreedesktopPicturesDirectory(): Promise<string | null> {
    const { configHome } = getXdgPaths();
    try {
      const content = await fs.readFile(path.join(configHome, 'user-dirs.dirs'), 'utf8');
      const match = content.match(/^XDG_PICTURES_DIR=(?:"([^"]*)"|'([^']*)'|([^\n#]*))\s*$/m);
      const value = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
      return value ? path.resolve(this.expandHome(value)) : null;
    } catch {
      return null;
    }
  }

  private getWindowsPicturesDirectory(): string {
    const profile = process.env['USERPROFILE'] || os.homedir();
    return path.join(profile, 'Pictures');
  }

  private expandHome(value: string): string {
    return value
      .replace(/^~(?=$|[\\/])/, os.homedir())
      .replace(/^\$HOME(?=$|[\\/])/, os.homedir())
      .replace(/^\$\{HOME\}(?=$|[\\/])/, os.homedir());
  }
}

export { imageMimeType } from '../../providers/image-media';

export function pathToFileUri(filePath: string): string {
  const normalized = path.resolve(filePath).split(path.sep).map(encodeURIComponent).join('/');
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}
