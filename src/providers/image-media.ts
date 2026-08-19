export type ImageFormat = 'png' | 'jpeg' | 'webp';

export interface DecodedImage {
  readonly bytes: Buffer;
  readonly format: ImageFormat;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

const MIME_FORMATS: Readonly<Record<string, ImageFormat>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/webp': 'webp',
};

export function imageMimeType(format: ImageFormat): DecodedImage['mimeType'] {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

export function decodeImageData(value: string): DecodedImage {
  if (!value || !value.trim()) throw new Error('Image data is empty.');

  const dataUri = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i);
  const declaredFormat = dataUri ? MIME_FORMATS[dataUri[1].toLowerCase()] : undefined;
  if (dataUri && !declaredFormat) throw new Error(`Unsupported image MIME type: ${dataUri[1]}.`);

  const encoded = dataUri?.[2] ?? value.trim();
  if (!encoded || encoded.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('Image data is not valid base64.');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0) throw new Error('Image data is empty.');

  const format = detectImageFormat(bytes);
  if (!format) throw new Error('Unsupported or corrupt image data; expected PNG, JPEG, or WebP.');
  if (declaredFormat && declaredFormat !== format) {
    throw new Error(`Image data URI declares ${declaredFormat} but contains ${format} bytes.`);
  }
  return { bytes, format, mimeType: imageMimeType(format) };
}

export function detectImageFormat(bytes: Uint8Array): ImageFormat | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return 'webp';
  return undefined;
}

export function imageFile(value: string, stem: string): File {
  const decoded = decodeImageData(value);
  return new File([decoded.bytes], `${stem}.${decoded.format}`, { type: decoded.mimeType });
}
