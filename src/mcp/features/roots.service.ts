import { Injectable, Logger } from '@nestjs/common';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { maskSecret } from '../../security/sanitise';

export interface WorkspaceRoot {
  uri: string;
  name?: string;
}

@Injectable()
export class RootsService {
  private readonly logger = new Logger(RootsService.name);

  /**
   * Server-side allowlist of permitted workspace root prefixes.
   * Read from WORKSPACE_ALLOWED_ROOTS (colon-separated absolute paths).
   *
   * Examples:
   *   WORKSPACE_ALLOWED_ROOTS=/home/user/workspace:/home/user/documents
   *   WORKSPACE_ALLOWED_ROOTS=/tmp/generated        (single path)
   *
   * If the env var is empty or unset, ALL file:// roots are accepted
   * (backward-compatible default for trusted single-user setups).
   *
   * In any multi-user or production deployment set this var explicitly.
   */
  private readonly allowedRootPrefixes: string[] = (
    process.env['WORKSPACE_ALLOWED_ROOTS'] ?? ''
  )
    .split(':')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p)); // normalise (remove trailing slash, resolve ..)

  // ─── public API ───────────────────────────────────────────────────────────

  /**
   * Discover workspace roots from the MCP client.
   * Returns an empty array if the client doesn't support roots.
   */
  async getRoots(server: Server): Promise<WorkspaceRoot[]> {
    try {
      // SDK v1.29: server.listRoots() — includes client capability pre-check
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (server as any).listRoots();
      return (result?.roots as WorkspaceRoot[]) ?? [];
    } catch (err) {
      this.logger.debug(`Roots not available: ${maskSecret(String(err))}`);
      return [];
    }
  }

  /**
   * Save a base64 image to the first workspace root that passes the allowlist.
   *
   * Security guarantees:
   *   1. Only file:// URIs are accepted (no http://, smb://, etc.)
   *   2. Root path validated against WORKSPACE_ALLOWED_ROOTS allowlist (if set)
   *   3. Generated filename is timestamp-based — no user input in the filename
   *   4. Final resolved path checked to be strictly inside root (path traversal)
   *
   * Returns the absolute file path written, or null if no safe root is available.
   */
  async saveImageToWorkspace(
    server: Server,
    b64Data: string,
    format: 'png' | 'jpeg' | 'webp' = 'png',
  ): Promise<string | null> {
    const roots = await this.getRoots(server);

    for (const root of roots) {
      const rootPath = this.uriToPath(root.uri);
      if (!rootPath) {
        this.logger.debug(`Skipping non-file:// root: ${root.uri}`);
        continue;
      }

      // H6: validate root against server-side allowlist
      if (!this.isRootAllowed(rootPath)) {
        this.logger.warn(
          `Root rejected by allowlist: ${rootPath}. ` +
          `Set WORKSPACE_ALLOWED_ROOTS to permit it.`,
        );
        continue;
      }

      const result = await this.writeImage(rootPath, b64Data, format);
      if (result) return result;
    }

    return null;
  }

  // ─── private ──────────────────────────────────────────────────────────────

  private isRootAllowed(rootPath: string): boolean {
    // No allowlist configured → accept all roots (single-user / dev mode)
    if (this.allowedRootPrefixes.length === 0) return true;

    const normalised = path.resolve(rootPath);
    return this.allowedRootPrefixes.some(
      (prefix) =>
        normalised === prefix ||
        normalised.startsWith(prefix + path.sep),
    );
  }

  private async writeImage(
    rootPath: string,
    b64Data: string,
    format: 'png' | 'jpeg' | 'webp',
  ): Promise<string | null> {
    // Create generated/ subdirectory
    const outputDir = path.join(rootPath, 'generated');
    await fs.mkdir(outputDir, { recursive: true });

    // Timestamp-only filename — no user input
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `img_${timestamp}.${format}`;
    const filePath = path.join(outputDir, filename);

    // Final path-traversal guard
    const resolved = path.resolve(filePath);
    const rootResolved = path.resolve(rootPath);
    if (!resolved.startsWith(rootResolved + path.sep)) {
      this.logger.warn(`Path traversal blocked: ${filePath}`);
      return null;
    }

    const buffer = Buffer.from(b64Data.replace(/^data:[^;]+;base64,/, ''), 'base64');
    await fs.writeFile(filePath, buffer);
    this.logger.log(`Image saved: ${filePath}`);
    return filePath;
  }

  private uriToPath(uri: string): string | null {
    if (!uri.startsWith('file://')) return null;
    // Handle file:///path (triple slash) and file://host/path
    const withoutScheme = uri.slice('file://'.length);
    // Strip optional localhost host
    const p = withoutScheme.startsWith('localhost')
      ? withoutScheme.slice('localhost'.length)
      : withoutScheme;
    return decodeURIComponent(p) || null;
  }
}
