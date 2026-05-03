import * as path from 'path';

/**
 * Masks secrets in strings to prevent accidental logging.
 * Patterns covered:
 *  - OpenAI API keys: sk-...
 *  - Azure API keys: UUID/GUID format (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
 *  - Bearer tokens
 *  - Long alphanumeric strings (32+ chars)
 */

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI API keys (sk-proj-..., sk-...)
  { pattern: /sk-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-***' },
  // Bearer tokens
  { pattern: /Bearer\s+[A-Za-z0-9._-]{16,}/gi, replacement: 'Bearer ***' },
  // Azure API keys are 32-char hex GUIDs (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  { pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, replacement: '***-guid-***' },
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
 * - Removes Unicode bidi/control characters that can reverse text display or hide injections
 * - Trims whitespace
 * - Enforces maximum length
 */
export function sanitisePrompt(prompt: string, maxLength: number): string {
  // Remove null bytes
  let clean = prompt.replace(/\0/g, '');
  // Remove Unicode bidi/control characters that can reverse text display or hide injections:
  // RTL override (U+202E), LTR override (U+202D), bidi embeddings (U+202A-U+202C),
  // zero-width chars (U+200B-U+200F), word joiners (U+2060), variation selectors (U+FE00-U+FE0F)
  clean = clean.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFE00-\uFE0F]/g, '');
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
 * Heuristic detection of prompts that may intend to fabricate
 * official-looking documents, screenshots, or impersonate organisations.
 * Returns true if the prompt matches a forgery-intent pattern.
 * Caller decides whether to block or log.
 *
 * Patterns: screenshot + auth page, explicit forgery language,
 * real domain names embedded in UI mock prompts.
 */
const FORGERY_PATTERNS: RegExp[] = [
  /\b(screenshot|screengrab|mockup)\b.{0,80}\b(login|password|captcha|verify|account|sign.?in)\b/i,
  /\b(fake|fabricate|forged?|spoof|impersonat)\b/i,
  /https?:\/\/[a-z0-9.-]*(google|apple|microsoft|amazon|paypal|facebook|instagram|twitter|bank)[a-z0-9.-]*\.[a-z]{2,}/i,
];

export function detectForgeryIntent(prompt: string): boolean {
  return FORGERY_PATTERNS.some(p => p.test(prompt));
}

/**
 * Validates a file path is within an allowed root and has no traversal.
 */
export function validateFilePath(filePath: string, allowedRoot: string): string {
  const resolved = path.resolve(filePath);
  const root = path.resolve(allowedRoot);

  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(
      `Path traversal detected: "${filePath}" is outside the allowed workspace root.`
    );
  }
  return resolved;
}
