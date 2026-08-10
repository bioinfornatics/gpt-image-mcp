import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('bin/start.sh', () => {
  it('defaults the MCP transport to stdio without overriding an explicit value', () => {
    const script = readFileSync(resolve(process.cwd(), 'bin/start.sh'), 'utf8');

    expect(script).toContain(
      'export IMAGE_MCP_TRANSPORT="${IMAGE_MCP_TRANSPORT:-stdio}"',
    );
  });
});
