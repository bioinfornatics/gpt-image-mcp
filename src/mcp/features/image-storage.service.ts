import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
export type ImageFormat = 'png' | 'jpeg' | 'webp';

@Injectable()
export class ImageStorageService {
  private readonly logger = new Logger(ImageStorageService.name);

  async saveImage(b64Data: string, format: ImageFormat = 'png'): Promise<string> {
    const outputDir = await this.getOutputDirectory();
    await fs.mkdir(outputDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = Math.random().toString(36).slice(2, 8);
    const filePath = path.join(outputDir, `img_${timestamp}_${suffix}.${format}`);
    const raw = b64Data.replace(/^data:[^;]+;base64,/, '');
    await fs.writeFile(filePath, Buffer.from(raw, 'base64'), { mode: 0o600 });
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
    if (configured) return configured;
    try {
      const { stdout } = await execFileAsync('xdg-user-dir', ['PICTURES'], { timeout: 1_000 });
      const result = stdout.trim();
      if (result && result !== os.homedir()) return path.resolve(this.expandHome(result));
    } catch {
      // xdg-user-dir is optional; use the localized project fallback below.
    }
    return path.join(os.homedir(), 'Images');
  }

  private async readFreedesktopPicturesDirectory(): Promise<string | null> {
    const configHome = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
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

export function imageMimeType(format: ImageFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

export function pathToFileUri(filePath: string): string {
  const normalized = path.resolve(filePath).split(path.sep).map(encodeURIComponent).join('/');
  return `file://${normalized.startsWith('/') ? '' : '/'}${normalized}`;
}
