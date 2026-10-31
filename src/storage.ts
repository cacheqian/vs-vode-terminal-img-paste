import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Image } from './image';
import { PasteError, systemCode } from './errors';
import { hasControlCharacters } from './terminal';

interface RecordData { version: 1; file: string; bytes: number; sha256: string; createdAt: string }
export interface StoredImage extends RecordData { record: string }
const NAME = /^terminal-img-paste-\d{8}T\d{6}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/;
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Reject symlink components before any file write. Never chmod an existing user directory. */
async function openDirectory(root: string, create: boolean): Promise<fs.FileHandle> {
  if (!path.isAbsolute(root) || path.resolve(root) !== root || hasControlCharacters(root)) throw new PasteError('STORAGE_PATH', '图片目录路径无效。');
  let current = '/';
  for (const component of root.split('/').filter(Boolean)) {
    current = path.join(current, component);
    if (create) {
      try { await fs.mkdir(current, { mode: 0o700 }); } catch (error) { if (systemCode(error) !== 'EEXIST') throw error; }
    }
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new PasteError('STORAGE_LINK', '图片目录及其父路径必须是普通目录，不能是符号链接。');
  }
  const handle = await fs.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  // Pin operations to the opened directory so later directory renames cannot redirect writes.
  if (await fs.realpath(`/proc/self/fd/${handle.fd}`) !== root) {
    await handle.close();
    throw new PasteError('STORAGE_CHANGED', '图片目录发生变化，请重试。');
  }
  return handle;
}

async function readRegular(file: string, limit: number): Promise<Buffer> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit) throw new PasteError('STORAGE_FILE', '文件类型、大小或归属不符合要求。');
    // Bounded read even if another process grows a file after stat().
    const data = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < data.length) {
      const result = await handle.read(data, offset, data.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset !== stat.size) throw new PasteError('STORAGE_CHANGED', '文件内容发生变化。');
    return data.subarray(0, offset);
  } finally { await handle.close(); }
}

function parseRecord(raw: Buffer, record: string): StoredImage | undefined {
  try {
    const item: unknown = JSON.parse(raw.toString('utf8'));
    if (!item || typeof item !== 'object') return;
    const r = item as Partial<RecordData>;
    if (r.version !== 1 || typeof r.file !== 'string' || !NAME.test(r.file) || record !== `.${r.file}.json` ||
        typeof r.bytes !== 'number' || !Number.isInteger(r.bytes) || r.bytes <= 0 || r.bytes > 20 * 1024 * 1024 ||
        typeof r.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.sha256) || typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) return;
    return { version: 1, file: r.file, bytes: r.bytes, sha256: r.sha256, createdAt: r.createdAt, record };
  } catch { return; }
}

export class ImageStore {
  constructor(public readonly root: string) {}

  async ensureDirectory(): Promise<string> {
    const directory = await openDirectory(this.root, true);
    await directory.close();
    return this.root;
  }

  async save(image: Image): Promise<string> {
    const directory = await openDirectory(this.root, true);
    const pinned = `/proc/self/fd/${directory.fd}`;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const file = `terminal-img-paste-${stamp}-${randomUUID()}.${image.extension}`;
    const record = `.${file}.json`;
    let wroteImage = false;
    let wroteRecord = false;
    try {
      if (!NAME.test(file)) throw new PasteError('STORAGE_PATH', '生成的文件名无效。');
      await fs.writeFile(path.join(pinned, file), image.data, { flag: 'wx', mode: 0o600 });
      wroteImage = true;
      const data: RecordData = { version: 1, file, bytes: image.data.length, sha256: digest(image.data), createdAt: new Date().toISOString() };
      await fs.writeFile(path.join(pinned, record), JSON.stringify(data), { flag: 'wx', mode: 0o600 });
      wroteRecord = true;
      const result = path.join(this.root, file);
      const persisted = await readRegular(result, image.data.length);
      if (digest(persisted) !== data.sha256) throw new PasteError('STORAGE_CHANGED', '图片写入后校验失败。');
      return result;
    } catch (error) {
      // These files have never been sent to a terminal. Preserve any unrelated existing files.
      if (wroteRecord) await fs.unlink(path.join(pinned, record));
      if (wroteImage) await fs.unlink(path.join(pinned, file));
      throw error;
    } finally { await directory.close(); }
  }

  private async verified(pinned: string, record: string): Promise<StoredImage | undefined> {
    if (!record.startsWith('.terminal-img-paste-') || !record.endsWith('.json') || path.basename(record) !== record) return;
    const item = parseRecord(await readRegular(path.join(pinned, record), 4096), record);
    if (!item) return;
    const data = await readRegular(path.join(pinned, item.file), item.bytes);
    if (data.length !== item.bytes || digest(data) !== item.sha256) return;
    return item;
  }

  async list(): Promise<{ images: StoredImage[]; skipped: number }> {
    let directory: fs.FileHandle;
    try { directory = await openDirectory(this.root, false); } catch (error) { if (systemCode(error) === 'ENOENT') return { images: [], skipped: 0 }; throw error; }
    try {
      const pinned = `/proc/self/fd/${directory.fd}`;
      const images: StoredImage[] = [];
      let skipped = 0;
      for (const entry of await fs.readdir(pinned)) {
        if (!entry.startsWith('.terminal-img-paste-') || !entry.endsWith('.json')) continue;
        try {
          const item = await this.verified(pinned, entry);
          if (item) images.push(item); else skipped++;
        } catch { skipped++; }
      }
      return { images: images.sort((a, b) => a.createdAt.localeCompare(b.createdAt)), skipped };
    } finally { await directory.close(); }
  }

  async remove(selected: StoredImage[]): Promise<{ removed: number; skipped: number }> {
    const directory = await openDirectory(this.root, false);
    try {
      const pinned = `/proc/self/fd/${directory.fd}`;
      let removed = 0;
      let skipped = 0;
      for (const selection of selected) {
        try {
          const current = await this.verified(pinned, selection.record);
          if (!current || current.sha256 !== selection.sha256 || current.file !== selection.file || current.createdAt !== selection.createdAt) { skipped++; continue; }
          await fs.unlink(path.join(pinned, current.file));
          removed++;
          await fs.unlink(path.join(pinned, current.record));
        } catch { skipped++; }
      }
      return { removed, skipped };
    } finally { await directory.close(); }
  }
}
