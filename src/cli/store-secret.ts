#!/usr/bin/env bun
/**
 * CLI helper — store an API key in the OS keychain via keytar.
 *
 * Usage:
 *   bun run src/cli/store-secret.ts OPENAI_API_KEY
 *   bun run src/cli/store-secret.ts AZURE_OPENAI_API_KEY
 *   bun run src/cli/store-secret.ts MCP_API_KEY
 *
 * Then in your .env / config set: SECRET_BACKEND=keytar
 * (and remove the plain-text API key env var entirely)
 *
 * Requires: bun add keytar  (native Node addon — needs build tools)
 */

import * as readline from 'readline';
import { storeKeytarSecret, deleteKeytarSecret } from '../config/secret-loader';
import type { FileSourceableVar } from '../config/secret-loader';

const SUPPORTED: FileSourceableVar[] = ['OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'MCP_API_KEY'];

const varName = process.argv[2] as FileSourceableVar | undefined;
const action  = process.argv[3] ?? 'store'; // 'store' | 'delete'

if (!varName || !SUPPORTED.includes(varName)) {
  console.error(`Usage: bun run src/cli/store-secret.ts <VAR_NAME> [store|delete]`);
  console.error(`Supported vars: ${SUPPORTED.join(', ')}`);
  process.exit(1);
}

if (action === 'delete') {
  const deleted = await deleteKeytarSecret(varName);
  if (deleted) {
    console.log(`✅ Deleted ${varName} from OS keychain.`);
  } else {
    console.log(`⚠️  ${varName} was not found in the OS keychain.`);
  }
  process.exit(0);
}

// Prompt for the secret value (hidden input via readline)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    // Hide input by temporarily suppressing echo
    if ((process.stdout as NodeJS.WriteStream).isTTY) {
      process.stdout.write(question);
      const stdin = process.stdin as NodeJS.ReadStream;
      stdin.setRawMode?.(true);
      let value = '';
      stdin.on('data', function handler(chunk: Buffer) {
        const char = chunk.toString();
        if (char === '\r' || char === '\n') {
          stdin.setRawMode?.(false);
          stdin.removeListener('data', handler);
          process.stdout.write('\n');
          resolve(value);
        } else if (char === '\u0003') {
          process.stdout.write('\n');
          process.exit(1);
        } else if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      });
      stdin.resume();
    } else {
      // Non-TTY (piped) — just read a line
      rl.question(question, resolve);
    }
  });
}

const value = await prompt(`Enter value for ${varName} (input hidden): `);
rl.close();

if (!value.trim()) {
  console.error('❌ Empty value — aborting.');
  process.exit(1);
}

await storeKeytarSecret(varName, value.trim());
console.log(`✅ ${varName} stored in OS keychain. Set SECRET_BACKEND=keytar in your config.`);
