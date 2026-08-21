import { Injectable, Logger } from '@nestjs/common';
import type { Server } from '@modelcontextprotocol/server';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { maskSecret } from '../../security/sanitise';
import { fileUriToLocalPath, isPathWithin } from './path-utils';

export interface WorkspaceRoot {
  uri: string;
  name?: string;
}

@Injectable()
export class RootsService {
  private readonly logger = new Logger(RootsService.name);

  /**
   * Server-side allowlist of permitted workspace root prefixes.
   * Read from IMAGE_WORKSPACE_ALLOWED_ROOTS using the platform path delimiter
   * (`:` on POSIX, `;` on Windows).
   *
   * Examples:
   *   IMAGE_WORKSPACE_ALLOWED_ROOTS=/home/user/workspace:/home/user/documents
   *   IMAGE_WORKSPACE_ALLOWED_ROOTS=C:\\workspace;D:\\documents
   *   IMAGE_WORKSPACE_ALLOWED_ROOTS=/tmp/generated        (single path)
   *
   * If the env var is empty or unset, ALL file:// roots are accepted
   * (backward-compatible default for trusted single-user setups).
   *
   * In any multi-user or production deployment set this var explicitly.
   */
  private readonly allowedRootPrefixes: string[] = (
    process.env['IMAGE_WORKSPACE_ALLOWED_ROOTS'] ?? ''
  )
    .split(path.delimiter)
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
      // MCP server v2: listRoots() is exposed by the inner Server connection.
      const result = await server.listRoots();
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
   *   2. Root path validated against IMAGE_WORKSPACE_ALLOWED_ROOTS allowlist (if set)
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
      if (!await this.isRootAllowed(rootPath)) {
        this.logger.warn(
          `Root rejected by allowlist: ${rootPath}. ` +
          `Set IMAGE_WORKSPACE_ALLOWED_ROOTS to permit it.`,
        );
        continue;
      }

      const result = await this.writeImage(rootPath, b64Data, format);
      if (result) return result;
    }

    return null;
  }

  // ─── private ──────────────────────────────────────────────────────────────

  private async isRootAllowed(rootPath: string): Promise<boolean> {
    // No allowlist configured → accept all roots (single-user / dev mode)
    if (this.allowedRootPrefixes.length === 0) return true;

    try {
      const rootReal = await fs.realpath(rootPath);
      for (const prefix of this.allowedRootPrefixes) {
        try {
          const prefixReal = await fs.realpath(prefix);
          if (isPathWithin(prefixReal, rootReal)) return true;
        } catch {
          // Ignore unavailable allowlist entries; they grant no access.
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  private async writeImage(
    rootPath: string,
    b64Data: string,
    format: 'png' | 'jpeg' | 'webp',
  ): Promise<string | null> {
    // Timestamp-only filename — no user input. Resolve and validate before
    // creating any directory so malformed roots cannot create side effects.
    const rootResolved = path.resolve(rootPath);
    let rootReal: string;
    try {
      const rootStat = await fs.lstat(rootResolved);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return null;
      rootReal = await fs.realpath(rootResolved);
    } catch (error) {
      this.logger.warn(`Workspace root unavailable: ${maskSecret(String(error))}`);
      return null;
    }

    const generated = path.join(rootReal, 'generated');
    try {
      await fs.mkdir(generated, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        this.logger.warn(`Cannot create workspace directory: ${maskSecret(String(error))}`);
        return null;
      }
    }

    try {
      const generatedStat = await fs.lstat(generated);
      if (!generatedStat.isDirectory() || generatedStat.isSymbolicLink()) {
        this.logger.warn('Workspace generated directory is a symlink/junction or not a directory.');
        return null;
      }
      const generatedReal = await fs.realpath(generated);
      if (!isPathWithin(rootReal, generatedReal) || generatedReal === rootReal) return null;

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `img_${timestamp}_${randomUUID()}.${format}`;
      const resolved = path.resolve(generatedReal, filename);
      if (!isPathWithin(generatedReal, resolved) || resolved === generatedReal) return null;

      const buffer = Buffer.from(b64Data.replace(/^data:[^;]+;base64,/, ''), 'base64');
      const handle = await fs.open(resolved, 'wx', 0o600);
      try {
        await handle.writeFile(buffer);
      } finally {
        await handle.close();
      }
      this.logger.log(`Image saved: ${resolved}`);
      return resolved;
    } catch (error) {
      this.logger.warn(`Unsafe or unavailable workspace path: ${maskSecret(String(error))}`);
      return null;
    }
  }

  private uriToPath(uri: string): string | null {
    return fileUriToLocalPath(uri);
  }
}
