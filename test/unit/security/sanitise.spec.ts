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
