import { describe, expect, it } from 'bun:test';
import { getVersion, HELP_TEXT, printHelp, printVersion } from '../../../src/cli/help';

describe('help', () => {
  it('HELP_TEXT documents all supported flags', () => {
    for (const flag of [
      '--help',
      '--version',
      '--check-config',
      '--show-config-sources',
      '--provider',
      '--base-url',
      '--foundry-project-endpoint',
      '--deployment',
      '--transport',
      '--port',
      '--log-level',
      '--api-key-file',
      '--mcp-api-key-file',
      '--no-elicitation',
      '--no-sampling',
      '--api-key',
      '--mcp-api-key',
    ]) {
      expect(HELP_TEXT).toContain(flag);
    }
  });

  it('getVersion returns a non-empty string matching package.json', () => {
    const version = getVersion();
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('printHelp writes HELP_TEXT via the provided writer', () => {
    const lines: string[] = [];
    printHelp((line) => lines.push(line));
    expect(lines).toEqual([HELP_TEXT]);
  });

  it('printVersion writes a line containing the bin name and version', () => {
    const lines: string[] = [];
    printVersion((line) => lines.push(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(getVersion());
  });

  it('is pure: importing the module performs no NestJS/secret/keytar side effects', async () => {
    // If this module transitively imported NestJS/secret-loader/keytar, importing
    // it in isolation (as done by the top-level import above) would already have
    // triggered module-load side effects (e.g. Reflect metadata polyfills,
    // filesystem secret resolution). We assert no unexpected globals leaked.
    const mod = await import('../../../src/cli/help');
    expect(Object.keys(mod).sort()).toEqual(
      ['CLI_BIN_NAME', 'HELP_TEXT', 'getVersion', 'printHelp', 'printVersion'].sort(),
    );
  });
});
