/**
 * Masks secrets in strings to prevent accidental logging.
 * Patterns covered:
 *  - OpenAI API keys: sk-...
 *  - Azure keys: 32+ char alphanumeric strings
 *  - Bearer tokens
 */

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI API keys (sk-proj-..., sk-...)
  { pattern: /sk-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-***' },
  // Bearer tokens
  { pattern: /Bearer\s+[A-Za-z0-9._-]{16,}/gi, replacement: 'Bearer ***' },
  // Long alphanumeric strings likely to be keys (32+ chars)
  { pattern: /\b[A-Za-z0-9]{32,}\b/g, replacement: '***' },
];

export function maskSecret(input: string): string {
  let result = input;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Sanitises user-supplied prompt strings.
 * - Removes null bytes
 * - Trims whitespace
 * - Enforces maximum length
 */
export function sanitisePrompt(prompt: string, maxLength: number): string {
  // Remove null bytes
  let clean = prompt.replace(/\0/g, '');
  // Trim
  clean = clean.trim();
  // Enforce length
  if (clean.length > maxLength) {
    throw new Error(
      `Prompt exceeds maximum length of ${maxLength} characters (got ${clean.length}).`
    );
  }
  return clean;
}

/**
 * Validates a file path is within an allowed root and has no traversal.
 */
export function validateFilePath(filePath: string, allowedRoot: string): string {
  const path = require('path') as typeof import('path');
  const resolved = path.resolve(filePath);
  const root = path.resolve(allowedRoot);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(
      `Path traversal detected: "${filePath}" is outside the allowed workspace root.`
    );
  }
  return resolved;
}
