import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

/**
 * Convert an MCP file URI to a local path without treating `/C:/...` as a
 * root-relative Windows path. Non-local authorities are rejected deliberately
 * rather than being reinterpreted as local relative paths.
 *
 * `platform` is injectable so Windows semantics can be regression-tested on
 * non-Windows CI runners.
 */
export function fileUriToLocalPath(
  uri: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost')) {
    return null;
  }

  try {
    if (platform === 'win32') {
      const decoded = decodeURIComponent(url.pathname);
      const drivePath = /^\/([A-Za-z]:\/.*)$/.exec(decoded)?.[1];
      if (!drivePath) return null;
      return path.win32.normalize(drivePath.replaceAll('/', '\\'));
    }
    return fileURLToPath(url);
  } catch {
    return null;
  }
}

/** Serialize a local path as a canonical file URI, preserving Windows drive colons. */
export function localPathToFileUri(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32' || /^[A-Za-z]:[\\/]/.test(filePath)) {
    const resolved = path.win32.resolve(filePath).replaceAll('\\', '/');
    if (!/^[A-Za-z]:\//.test(resolved)) {
      throw new Error(`Cannot convert non-drive Windows path to a local file URI: ${filePath}`);
    }
    return new URL(`file:///${resolved}`).href;
  }
  return pathToFileURL(path.resolve(filePath)).href;
}

/** Robust lexical containment check for normalized local paths. */
export function isPathWithin(
  rootPath: string,
  candidatePath: string,
  pathApi: typeof path.posix | typeof path.win32 = path,
): boolean {
  const root = pathApi.resolve(rootPath);
  const candidate = pathApi.resolve(candidatePath);
  const relative = pathApi.relative(root, candidate);
  return relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative));
}
