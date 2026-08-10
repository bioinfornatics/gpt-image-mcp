import * as os from 'os';
import * as path from 'path';

/** Freedesktop Base Directory defaults, resolved even when distributions do not export XDG_* variables. */
export function getXdgPaths(home = os.homedir(), env: NodeJS.ProcessEnv = process.env) {
  return {
    home,
    dataHome: path.resolve(env['XDG_DATA_HOME'] || path.join(home, '.local', 'share')),
    configHome: path.resolve(env['XDG_CONFIG_HOME'] || path.join(home, '.config')),
    cacheHome: path.resolve(env['XDG_CACHE_HOME'] || path.join(home, '.cache')),
    stateHome: path.resolve(env['XDG_STATE_HOME'] || path.join(home, '.local', 'state')),
    runtimeDir: env['XDG_RUNTIME_DIR'] ? path.resolve(env['XDG_RUNTIME_DIR']) : undefined,
  } as const;
}

export const XDG_PATHS = getXdgPaths();
