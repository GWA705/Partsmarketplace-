import 'server-only';
import sharp from 'sharp';

/**
 * Normalise an uploaded part photo.
 *
 * Nobody is going to photograph 1,380 parts, so the ones that do get a picture
 * are added one at a time by whoever cares — usually straight off a phone, at
 * several megabytes and rotated by EXIF. Resize, strip metadata, and re-encode
 * to WebP so the catalogue page stays fast.
 */
export interface NormalizedImage {
  buffer: Buffer;
  mime: string;
  bytes: number;
}

const MAX_EDGE = 1200;

export async function normalizeImage(input: Buffer): Promise<NormalizedImage> {
  const buffer = await sharp(input)
    .rotate() // honour EXIF orientation, then drop the tag
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();

  return { buffer, mime: 'image/webp', bytes: buffer.length };
}
