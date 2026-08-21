import * as path from 'path';
import { fileUriToLocalPath, isPathWithin, localPathToFileUri } from '../../../../src/mcp/features/path-utils';

describe('Windows-safe path utilities', () => {
  it('converts a Windows file URI without duplicating the drive', () => {
    expect(fileUriToLocalPath('file:///C:/somewhere', 'win32')).toBe('C:\\somewhere');
    expect(fileUriToLocalPath('file://localhost/C:/somewhere', 'win32')).toBe('C:\\somewhere');
  });

  it('decodes Windows URI segments and rejects malformed or remote roots', () => {
    expect(fileUriToLocalPath('file:///C:/My%20Workspace', 'win32')).toBe('C:\\My Workspace');
    expect(fileUriToLocalPath('file:///C:/bad%ZZpath', 'win32')).toBeNull();
    expect(fileUriToLocalPath('file://server/share/path', 'win32')).toBeNull();
    expect(fileUriToLocalPath('https://example.com/C:/path', 'win32')).toBeNull();
  });

  it('serializes Windows paths with an unescaped drive colon', () => {
    expect(localPathToFileUri('C:\\somewhere\\My Image.png', 'win32'))
      .toBe('file:///C:/somewhere/My%20Image.png');
  });

  it('proves the generated path is C:\\somewhere, never C:\\C:\\somewhere', () => {
    const root = fileUriToLocalPath('file:///C:/somewhere', 'win32')!;
    const generated = path.win32.resolve(root, 'generated', 'image.png');
    expect(generated).toBe('C:\\somewhere\\generated\\image.png');
    expect(generated).not.toContain('C:\\C:\\');
    expect(isPathWithin(root, generated, path.win32)).toBe(true);
  });

  it('rejects Windows traversal and cross-drive paths', () => {
    expect(isPathWithin('C:\\workspace', 'C:\\workspace\\generated\\image.png', path.win32)).toBe(true);
    expect(isPathWithin('C:\\workspace', 'C:\\workspace-other\\image.png', path.win32)).toBe(false);
    expect(isPathWithin('C:\\workspace', 'D:\\image.png', path.win32)).toBe(false);
  });
});
