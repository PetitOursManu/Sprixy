import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { newId } from './crypto.js';

/** Files are stored under DATA_DIR/files/<userId>/<bucket>/<id>.<ext>; DB keeps the relative path. */
export function absPath(rel: string): string {
  const p = path.resolve(config.filesDir, rel);
  if (!p.startsWith(path.resolve(config.filesDir))) throw new Error('Path escapes storage root');
  return p;
}

export async function saveFile(userId: string, bucket: string, data: Buffer | Uint8Array, ext: string): Promise<string> {
  const rel = path.posix.join(userId, bucket, `${newId()}.${ext.replace(/^\./, '')}`);
  const abs = absPath(rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
  return rel;
}

export async function overwriteFile(rel: string, data: Buffer | Uint8Array): Promise<void> {
  const abs = absPath(rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
}

export function readStored(rel: string): Promise<Buffer> {
  return readFile(absPath(rel));
}

export async function deleteStored(rel: string | null | undefined): Promise<void> {
  if (!rel) return;
  await rm(absPath(rel), { force: true });
}

export async function storedSize(rel: string): Promise<number> {
  try {
    return (await stat(absPath(rel))).size;
  } catch {
    return 0;
  }
}
