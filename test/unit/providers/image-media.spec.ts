import { describe, expect, it } from 'bun:test';
import { decodeImageData, imageFile } from '../../../src/providers/image-media';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
const WEBP = Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary').toString('base64');

describe('image media contract', () => {
  it.each([
    [PNG, 'png', 'image/png'],
    [JPEG, 'jpeg', 'image/jpeg'],
    [WEBP, 'webp', 'image/webp'],
  ] as const)('detects supported magic bytes', (data, format, mimeType) => {
    expect(decodeImageData(data)).toMatchObject({ format, mimeType });
  });

  it('creates a JPEG File with coherent name and MIME', () => {
    const file = imageFile('data:image/jpeg;base64,' + JPEG, 'input');
    expect(file.name).toBe('input.jpeg');
    expect(file.type).toBe('image/jpeg');
  });

  it('rejects a data URI whose declared MIME conflicts with its bytes', () => {
    expect(() => decodeImageData('data:image/jpeg;base64,' + PNG)).toThrow(/declares jpeg.*png bytes/i);
  });

  it.each(['', 'not-base64!', Buffer.from('text').toString('base64')])('rejects empty, malformed, or unsupported data', (data) => {
    expect(() => decodeImageData(data)).toThrow();
  });
});
