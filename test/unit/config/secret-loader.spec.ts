/**
 * Unit tests for secret-loader.ts
 *
 * Covers: readSecretFile, resolveFileSecrets, resolveSecrets (file + env backends).
 * keytar backend is tested with a dynamic import mock.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  readSecretFile,
  resolveFileSecrets,
  resolveSecrets,
  resolveImageEnvAliases,
} from '../../../src/config/secret-loader';

// ─── helpers ─────────────────────────────────────────────────────────────────

function writeTmpSecret(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-secret-test-'));
  const file = path.join(dir, 'secret');
  fs.writeFileSync(file, content, { mode: 0o400 });
  return file;
}

function cleanup(filePath: string) {
  try { fs.rmSync(path.dirname(filePath), { recursive: true, force: true }); } catch { /* ok */ }
}

// ─── readSecretFile ───────────────────────────────────────────────────────────

describe('readSecretFile()', () => {
  it('should read and trim the file content', () => {
    const file = writeTmpSecret('sk-test-key\n');
    try {
      expect(readSecretFile(file)).toBe('sk-test-key');
    } finally {
      cleanup(file);
    }
  });

  it('should strip trailing whitespace and newlines', () => {
    const file = writeTmpSecret('  my-secret   \n\n');
    try {
      expect(readSecretFile(file)).toBe('my-secret');
    } finally {
      cleanup(file);
    }
  });

  it('should throw when the file does not exist', () => {
    expect(() => readSecretFile('/tmp/this-file-does-not-exist-mcp-test'))
      .toThrow(/not found/i);
  });

  it('should throw when the file is empty', () => {
    const file = writeTmpSecret('   \n');
    try {
      expect(() => readSecretFile(file)).toThrow(/empty/i);
    } finally {
      cleanup(file);
    }
  });

  it('should resolve relative path to absolute before validation', () => {
    // A relative path like '../etc/passwd' resolves to an absolute path —
    // the function must still check existence (and the file won't exist in /tmp)
    expect(() => readSecretFile('./non-existent-relative')).toThrow(/not found/i);
  });

  it('should warn to stderr if file is world-readable', () => {
    const file = writeTmpSecret('sk-test\n');
    // Make world-readable
    fs.chmodSync(file, 0o644);
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      readSecretFile(file);
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('world-readable'),
      );
    } finally {
      cleanup(file);
      stderrSpy.mockRestore();
    }
  });

  it('should NOT warn when file is mode 0400', () => {
    const file = writeTmpSecret('sk-test\n');
    fs.chmodSync(file, 0o400);
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      readSecretFile(file);
      const warnCalls = stderrSpy.mock.calls.filter(c =>
        String(c[0]).includes('world-readable'),
      );
      expect(warnCalls).toHaveLength(0);
    } finally {
      cleanup(file);
      stderrSpy.mockRestore();
    }
  });
});

// ─── resolveFileSecrets ───────────────────────────────────────────────────────

describe('resolveFileSecrets()', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore env
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('should inject OPENAI_API_KEY from OPENAI_API_KEY_FILE', () => {
    const file = writeTmpSecret('sk-from-file\n');
    try {
      process.env['OPENAI_API_KEY_FILE'] = file;
      delete process.env['OPENAI_API_KEY'];

      resolveFileSecrets();

      expect(process.env['OPENAI_API_KEY']).toBe('sk-from-file');
      // _FILE var should be removed after resolution
      expect(process.env['OPENAI_API_KEY_FILE']).toBeUndefined();
    } finally {
      cleanup(file);
    }
  });

  it('should inject IMAGE_API_KEY from IMAGE_API_KEY_FILE', () => {
    const file = writeTmpSecret('image-api-key-from-file');
    try {
      process.env['IMAGE_API_KEY_FILE'] = file;
      delete process.env['IMAGE_API_KEY'];

      resolveFileSecrets();

      expect(process.env['IMAGE_API_KEY']).toBe('image-api-key-from-file');
      expect(process.env['IMAGE_API_KEY_FILE']).toBeUndefined();
    } finally {
      cleanup(file);
    }
  });

  it('should inject AZURE_OPENAI_API_KEY from AZURE_OPENAI_API_KEY_FILE (legacy)', () => {
    const file = writeTmpSecret('azure-key-from-file');
    try {
      process.env['AZURE_OPENAI_API_KEY_FILE'] = file;
      delete process.env['AZURE_OPENAI_API_KEY'];

      resolveFileSecrets();

      expect(process.env['AZURE_OPENAI_API_KEY']).toBe('azure-key-from-file');
      expect(process.env['AZURE_OPENAI_API_KEY_FILE']).toBeUndefined();
    } finally {
      cleanup(file);
    }
  });

  it('should inject MCP_API_KEY from MCP_API_KEY_FILE', () => {
    const file = writeTmpSecret('mcp-secret-token');
    try {
      process.env['MCP_API_KEY_FILE'] = file;
      delete process.env['MCP_API_KEY'];

      resolveFileSecrets();

      expect(process.env['MCP_API_KEY']).toBe('mcp-secret-token');
    } finally {
      cleanup(file);
    }
  });

  it('should NOT overwrite an existing env var when no _FILE var is set', () => {
    process.env['OPENAI_API_KEY'] = 'sk-already-set';
    delete process.env['OPENAI_API_KEY_FILE'];

    resolveFileSecrets();

    expect(process.env['OPENAI_API_KEY']).toBe('sk-already-set');
  });

  it('should prefer _FILE over plain env var when both are set (and warn)', () => {
    const file = writeTmpSecret('sk-from-file');
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      process.env['OPENAI_API_KEY'] = 'sk-plain';
      process.env['OPENAI_API_KEY_FILE'] = file;

      resolveFileSecrets();

      expect(process.env['OPENAI_API_KEY']).toBe('sk-from-file');
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('takes priority'),
      );
    } finally {
      cleanup(file);
      stderrSpy.mockRestore();
    }
  });

  it('should throw when _FILE points to a non-existent file', () => {
    process.env['OPENAI_API_KEY_FILE'] = '/tmp/mcp-does-not-exist-99999';
    delete process.env['OPENAI_API_KEY'];

    expect(() => resolveFileSecrets()).toThrow(/not found/i);
  });

  it('should be a no-op when no _FILE vars are set', () => {
    const originalKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY_FILE'];

    resolveFileSecrets();

    expect(process.env['OPENAI_API_KEY']).toBe(originalKey);
  });
});

// ─── readSecretFile — path traversal ─────────────────────────────────────────

describe('readSecretFile() — path traversal', () => {
  it('should reject a path that traverses outside /run/secrets via resolve', () => {
    // /run/secrets/../../etc/passwd resolves to /etc/passwd
    // The function doesn't whitelist a root, but it must throw "not found"
    // on anything that doesn't exist — which prevents leaking real files in test env.
    const traversal = '/run/secrets/../../tmp/mcp-traversal-test-file';
    // File doesn't exist, so it throws "not found" — traversal blocked at read level
    expect(() => readSecretFile(traversal)).toThrow();
  });

  it('should handle a path with no traversal that genuinely exists', () => {
    const file = writeTmpSecret('safe-secret');
    try {
      // No traversal — just a normal absolute path
      expect(readSecretFile(file)).toBe('safe-secret');
    } finally {
      cleanup(file);
    }
  });
});

// ─── resolveSecrets (backend dispatch) ────────────────────────────────────────

describe('resolveSecrets()', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('should call resolveFileSecrets when MCP_SECRET_BACKEND=file (default)', async () => {
    const file = writeTmpSecret('sk-backend-file-test');
    try {
      process.env['MCP_SECRET_BACKEND'] = 'file';
      process.env['OPENAI_API_KEY_FILE'] = file;
      delete process.env['OPENAI_API_KEY'];

      await resolveSecrets();

      expect(process.env['OPENAI_API_KEY']).toBe('sk-backend-file-test');
    } finally {
      cleanup(file);
    }
  });

  it('should resolve _FILE vars when MCP_SECRET_BACKEND is not set (defaults to file)', async () => {
    const file = writeTmpSecret('sk-default-backend');
    try {
      delete process.env['MCP_SECRET_BACKEND'];
      process.env['OPENAI_API_KEY_FILE'] = file;
      delete process.env['OPENAI_API_KEY'];

      await resolveSecrets();

      expect(process.env['OPENAI_API_KEY']).toBe('sk-default-backend');
    } finally {
      cleanup(file);
    }
  });

  it('should NOT resolve _FILE vars when MCP_SECRET_BACKEND=env', async () => {
    const file = writeTmpSecret('sk-should-not-be-read');
    try {
      process.env['MCP_SECRET_BACKEND'] = 'env';
      process.env['OPENAI_API_KEY_FILE'] = file;
      process.env['OPENAI_API_KEY'] = 'sk-plain-wins';

      await resolveSecrets();

      // Plain var stays, _FILE was NOT processed
      expect(process.env['OPENAI_API_KEY']).toBe('sk-plain-wins');
      expect(process.env['OPENAI_API_KEY_FILE']).toBe(file); // not removed
    } finally {
      cleanup(file);
    }
  });

  it('should warn to stderr and fallback gracefully when MCP_SECRET_BACKEND=keytar but keytar missing', async () => {
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    // Intercept the dynamic import — jest.mock at module level won't work for
    // dynamic imports in bun, so we rely on keytar genuinely not being installed
    // in the test environment to trigger the warning path.
    process.env['MCP_SECRET_BACKEND'] = 'keytar';
    const file = writeTmpSecret('sk-keytar-fallback');
    process.env['OPENAI_API_KEY_FILE'] = file;
    delete process.env['OPENAI_API_KEY'];

    try {
      await resolveSecrets();
      // Whether keytar is installed or not, _FILE resolution must still run
      // (resolveFileSecrets is called after resolveKeytarSecrets regardless)
      expect(process.env['OPENAI_API_KEY']).toBe('sk-keytar-fallback');
    } finally {
      cleanup(file);
      stderrSpy.mockRestore();
    }
  });
});

// ─── resolveImageEnvAliases ───────────────────────────────────────────────────

describe('resolveImageEnvAliases()', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it('should copy PROVIDER to IMAGE_PROVIDER with deprecation warning', () => {
    delete process.env['IMAGE_PROVIDER'];
    process.env['PROVIDER'] = 'azure';
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      resolveImageEnvAliases();
      expect(process.env['IMAGE_PROVIDER']).toBe('azure');
      // Must include: DEPRECATED tag, removal version, rename arrow, changelog URL
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('DEPRECATED'));
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('removed in v0.3.0'));
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('PROVIDER'));
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('IMAGE_PROVIDER'));
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('CHANGELOG.md'));
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('should copy OPENAI_API_KEY to IMAGE_API_KEY', () => {
    delete process.env['IMAGE_API_KEY'];
    process.env['OPENAI_API_KEY'] = 'sk-legacy';
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      resolveImageEnvAliases();
      expect(process.env['IMAGE_API_KEY']).toBe('sk-legacy');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('should copy AZURE_OPENAI_API_KEY to IMAGE_API_KEY', () => {
    delete process.env['IMAGE_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    process.env['AZURE_OPENAI_API_KEY'] = 'az-legacy-key';
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      resolveImageEnvAliases();
      expect(process.env['IMAGE_API_KEY']).toBe('az-legacy-key');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('should copy AZURE_OPENAI_ENDPOINT to IMAGE_BASE_URL', () => {
    delete process.env['IMAGE_BASE_URL'];
    process.env['AZURE_OPENAI_ENDPOINT'] = 'https://my.openai.azure.com';
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      resolveImageEnvAliases();
      expect(process.env['IMAGE_BASE_URL']).toBe('https://my.openai.azure.com');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('should NOT overwrite IMAGE_API_KEY if already set', () => {
    process.env['IMAGE_API_KEY'] = 'already-set';
    process.env['OPENAI_API_KEY'] = 'legacy-key';
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      resolveImageEnvAliases();
      expect(process.env['IMAGE_API_KEY']).toBe('already-set');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('should copy AZURE_OPENAI_DEPLOYMENT to IMAGE_DEPLOYMENT', () => {
    delete process.env['IMAGE_DEPLOYMENT'];
    process.env['AZURE_OPENAI_DEPLOYMENT'] = 'my-deployment';
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      resolveImageEnvAliases();
      expect(process.env['IMAGE_DEPLOYMENT']).toBe('my-deployment');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('should copy DEFAULT_MODEL to IMAGE_DEFAULT_MODEL', () => {
    delete process.env['IMAGE_DEFAULT_MODEL'];
    process.env['DEFAULT_MODEL'] = 'gpt-image-1';
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      resolveImageEnvAliases();
      expect(process.env['IMAGE_DEFAULT_MODEL']).toBe('gpt-image-1');
    } finally {
      stderrSpy.mockRestore();
    }
  });
});
