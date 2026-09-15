import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

/**
 * Part photo storage. Ported from the booking portal, which already runs this
 * against the same bucket setup.
 *
 *   local — writes under LOCAL_STORAGE_DIR. TEST DATA ONLY: ephemeral disk.
 *   s3    — production. ca-central-1 for data residency.
 *
 * Images are never served from a public URL; they come back through an
 * authenticated route.
 */

export type StorageDriver = 'local' | 's3';

export function driver(): StorageDriver {
  return process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local';
}

/**
 * The driver we can actually use. Config may ask for S3 everywhere while a
 * preview box has no bucket wired up; there, an upload should fall to local
 * disk and work rather than throwing at whoever pressed the button. With a
 * bucket set, S3 is used and a real S3 failure is NOT swallowed.
 */
export function effectiveDriver(): StorageDriver {
  if (driver() === 's3' && !process.env.S3_BUCKET) return 'local';
  return driver();
}

export function storageReady(): boolean {
  return effectiveDriver() === 'local' || !!process.env.S3_BUCKET;
}

function localDir(): string {
  return process.env.LOCAL_STORAGE_DIR || path.join(os.tmpdir(), 'gwa-parts-uploads');
}

/** Opaque, date-partitioned key so a bucket listing stays navigable. */
export function newKey(prefix: string, ext: string): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = crypto.randomBytes(16).toString('hex');
  return `${prefix}/${y}/${m}/${id}${ext.startsWith('.') ? ext : `.${ext}`}`;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  if (effectiveDriver() === 's3') {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region: process.env.S3_REGION || 'ca-central-1' });
    await client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
    return;
  }
  const full = path.join(localDir(), key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, body);
}

export async function getObject(key: string): Promise<Buffer | null> {
  if (effectiveDriver() === 's3') {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region: process.env.S3_REGION || 'ca-central-1' });
    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
      );
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(chunk);
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
  try {
    return await fs.readFile(path.join(localDir(), key));
  } catch {
    return null;
  }
}

export async function deleteObject(key: string): Promise<void> {
  if (effectiveDriver() === 's3') {
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({ region: process.env.S3_REGION || 'ca-central-1' });
    await client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return;
  }
  await fs.rm(path.join(localDir(), key), { force: true });
}
