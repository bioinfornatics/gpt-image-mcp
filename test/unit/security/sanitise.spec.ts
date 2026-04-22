import { maskSecret, sanitisePrompt, validateFilePath } from '../../../src/security/sanitise';

describe('maskSecret', () => {
  it('should mask OpenAI API keys (sk-...)', () => {
    const input = 'Error: invalid key sk-proj-abc123def456ghi789jkl012';
    const result = maskSecret(input);
    expect(result).not.toContain('sk-proj-abc123def456ghi789jkl012');
    expect(result).toContain('sk-***');
  });

  it('should mask Bearer tokens', () => {
    const input = 'Authorization: Bearer mysupersecrettoken123456789';
    const result = maskSecret(input);
    expect(result).not.toContain('mysupersecrettoken123456789');
  });

  it('should mask 32+ char alphanumeric strings (Azure keys)', () => {
    const azureKey = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
    expect(azureKey.length).toBeGreaterThanOrEqual(32);
    const result = maskSecret(`key=${azureKey}`);
    expect(result).not.toContain(azureKey);
  });

  it('should mask Azure GUID/UUID format keys', () => {
    const azureGuid = '12345678-abcd-ef01-2345-6789abcdef01';
    const result = maskSecret(`api-key: ${azureGuid}`);
    expect(result).not.toContain(azureGuid);
    expect(result).toContain('***-guid-***');
  });

  it('should leave safe strings unchanged', () => {
    const safe = 'Model gpt-image-1 returned 200 OK';
    expect(maskSecret(safe)).toBe(safe);
  });
});

describe('sanitisePrompt', () => {
  it('should remove null bytes', () => {
    const result = sanitisePrompt('hello\0world', 1000);
    expect(result).toBe('helloworld');
  });

  it('should trim whitespace', () => {
    const result = sanitisePrompt('  a cat  ', 1000);
    expect(result).toBe('a cat');
  });

  it('should throw when prompt exceeds maxLength', () => {
    expect(() => sanitisePrompt('a'.repeat(101), 100)).toThrow(/maximum length/i);
  });

  it('should accept prompt at exactly maxLength', () => {
    const result = sanitisePrompt('a'.repeat(100), 100);
    expect(result).toHaveLength(100);
  });

  it('should strip RTL override character (U+202E)', () => {
    const input = 'hello\u202Eworld';
    const result = sanitisePrompt(input, 1000);
    expect(result).toBe('helloworld');
    expect(result).not.toContain('\u202E');
  });

  it('should strip zero-width space character (U+200B)', () => {
    const input = 'hello\u200Bworld';
    const result = sanitisePrompt(input, 1000);
    expect(result).toBe('helloworld');
    expect(result).not.toContain('\u200B');
  });

  it('should strip LTR override character (U+202D)', () => {
    const input = 'test\u202Dprompt';
    const result = sanitisePrompt(input, 1000);
    expect(result).toBe('testprompt');
    expect(result).not.toContain('\u202D');
  });

  it('should strip word joiner character (U+2060)', () => {
    const input = 'word\u2060joiner';
    const result = sanitisePrompt(input, 1000);
    expect(result).toBe('wordjoiner');
    expect(result).not.toContain('\u2060');
  });

  it('should strip variation selector (U+FE00)', () => {
    const input = 'test\uFE00prompt';
    const result = sanitisePrompt(input, 1000);
    expect(result).toBe('testprompt');
    expect(result).not.toContain('\uFE00');
  });

  it('should strip multiple bidi/control characters', () => {
    const input = '\u202Ahidden\u202B injection\u202C attempt\u202E';
    const result = sanitisePrompt(input, 1000);
    expect(result).not.toMatch(/[\u202A-\u202E]/);
  });
});

describe('validateFilePath', () => {
  it('should throw on path traversal attempt', () => {
    expect(() =>
      validateFilePath('/workspace/../../etc/passwd', '/workspace'),
    ).toThrow(/path traversal/i);
  });

  it('should accept valid path within root', () => {
    const result = validateFilePath('/workspace/generated/img.png', '/workspace');
    expect(result).toContain('/workspace');
    expect(result).toContain('img.png');
  });
});
