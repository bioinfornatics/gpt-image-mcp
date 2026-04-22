import { Injectable, Logger } from '@nestjs/common';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface WorkspaceRoot {
  uri: string;
  name?: string;
}

@Injectable()
export class RootsService {
  private readonly logger = new Logger(RootsService.name);

  /**
   * Discover workspace roots from the client.
   * Returns an empty array if the client doesn't support roots.
   */
  async getRoots(server: Server): Promise<WorkspaceRoot[]> {
    try {
      // SDK v1.29: server.listRoots() — includes client capability pre-check
      const result = await (server as any).listRoots();
      return (result?.roots as WorkspaceRoot[]) ?? [];
    } catch (err) {
      this.logger.debug(`Roots not available: ${String(err)}`);
      return [];
    }
  }

  /**
   * Save a base64 image to the first available workspace root.
   * Returns the absolute file path, or null if no root is available.
   */
  async saveImageToWorkspace(
    server: Server,
    b64Data: string,
    format: 'png' | 'jpeg' | 'webp' = 'png',
  ): Promise<string | null> {
    const roots = await this.getRoots(server);
    if (roots.length === 0) return null;

    const firstRoot = roots[0];
    const rootPath = this.uriToPath(firstRoot.uri);
    if (!rootPath) return null;

    // Create generated/ subdirectory
    const outputDir = path.join(rootPath, 'generated');
    await fs.mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `img_${timestamp}.${format}`;
    const filePath = path.join(outputDir, filename);

    // Validate path is within root (security)
    const resolved = path.resolve(filePath);
    const rootResolved = path.resolve(rootPath);
    if (!resolved.startsWith(rootResolved + path.sep)) {
      this.logger.warn(`Path traversal attempt blocked: ${filePath}`);
      return null;
    }

    const buffer = Buffer.from(b64Data.replace(/^data:[^;]+;base64,/, ''), 'base64');
    await fs.writeFile(filePath, buffer);
    this.logger.log(`Image saved to: ${filePath}`);
    return filePath;
  }

  private uriToPath(uri: string): string | null {
    if (uri.startsWith('file://')) {
      return decodeURIComponent(uri.slice('file://'.length));
    }
    return null;
  }
}
