import * as path from 'path';
import { getXdgPaths } from '../../../src/config/xdg-paths';

describe('getXdgPaths', () => {
  it('uses freedesktop defaults when XDG variables are absent', () => {
    const paths = getXdgPaths('/home/tester', {});
    expect(paths.dataHome).toBe('/home/tester/.local/share');
    expect(paths.configHome).toBe('/home/tester/.config');
    expect(paths.cacheHome).toBe('/home/tester/.cache');
    expect(paths.stateHome).toBe('/home/tester/.local/state');
    expect(paths.runtimeDir).toBeUndefined();
  });

  it('honors explicit XDG locations', () => {
    const paths = getXdgPaths('/home/tester', {
      XDG_DATA_HOME: '/data', XDG_CONFIG_HOME: '/config', XDG_CACHE_HOME: '/cache',
      XDG_STATE_HOME: '/state', XDG_RUNTIME_DIR: '/run/user/1000',
    });
    expect(paths).toEqual({
      home: '/home/tester', dataHome: path.resolve('/data'), configHome: path.resolve('/config'),
      cacheHome: path.resolve('/cache'), stateHome: path.resolve('/state'),
      runtimeDir: path.resolve('/run/user/1000'),
    });
  });
});
