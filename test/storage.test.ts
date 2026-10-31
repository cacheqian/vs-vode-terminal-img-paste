import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ImageStore } from '../src/storage';
import { validateImage, type Image } from '../src/image';
import sharp from 'sharp';

let temporary: string, root: string, store: ImageStore, image: Image;
beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wsl-image-test-'));
  root = path.join(temporary, 'images'); store = new ImageStore(root);
  image = await validateImage(await sharp({ create: { width: 1, height: 1, channels: 3, background: 'blue' } }).png().toBuffer());
});
afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

describe('persistent image store', () => {
  it('uses plugin names, 0600 images, 0700 new directories and matching ownership records', async () => {
    const result = await store.save(image);
    expect(path.basename(result)).toMatch(/^terminal-img-paste-\d{8}T\d{6}Z-.*\.png$/);
    expect((await fs.stat(result)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(root)).mode & 0o777).toBe(0o700);
    expect((await store.list()).images).toHaveLength(1);
    expect(await fs.readFile(result)).toEqual(image.data);
  });
  it('preserves more than twenty images across concurrent windows and store recreation', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, () => new ImageStore(root).save(image)));
    expect(new Set(results).size).toBe(25);
    expect((await new ImageStore(root).list()).images).toHaveLength(25);
    for (const result of results) expect(await fs.readFile(result)).toEqual(image.data);
  });
  it('rejects a directory symlink before any outside write', async () => {
    const outside = path.join(temporary, 'outside'); await fs.mkdir(outside); await fs.symlink(outside, root);
    await expect(store.save(image)).rejects.toThrow(/符号链接/);
    expect(await fs.readdir(outside)).toEqual([]);
  });
  it('rejects a symlink ancestor and noncanonical paths', async () => {
    const outside = path.join(temporary, 'outside'); await fs.mkdir(outside); await fs.symlink(outside, root);
    await expect(new ImageStore(path.join(root, 'child')).save(image)).rejects.toThrow();
    expect(await fs.readdir(outside)).toEqual([]);
    await expect(new ImageStore(root + '/../outside').save(image)).rejects.toThrow();
  });
  it('does not modify user files or .gitignore, and cleans only the confirmed snapshot', async () => {
    const ignore = path.join(temporary, '.gitignore'); await fs.writeFile(ignore, 'original\n');
    await store.save(image); await fs.writeFile(path.join(root, 'user.png'), image.data);
    const selected = (await store.list()).images;
    const newer = await store.save(image);
    expect(await store.remove(selected)).toEqual({ removed: 1, skipped: 0 });
    expect(await fs.readFile(newer)).toEqual(image.data);
    expect(await fs.readFile(path.join(root, 'user.png'))).toEqual(image.data);
    expect(await fs.readFile(ignore, 'utf8')).toBe('original\n');
  });
  it('refuses changed contents, symlink images and damaged records', async () => {
    const first = await store.save(image), second = await store.save(image);
    const selected = (await store.list()).images;
    await fs.writeFile(first, 'changed');
    const outside = path.join(temporary, 'outside.png'); await fs.writeFile(outside, image.data);
    await fs.unlink(second); await fs.symlink(outside, second);
    await fs.writeFile(path.join(root, '.terminal-img-paste-broken.json'), '{broken');
    expect(await store.remove(selected)).toEqual({ removed: 0, skipped: 2 });
    expect(await fs.readFile(outside)).toEqual(image.data);
    expect(await store.list()).toMatchObject({ images: [], skipped: 3 });
  });
  it('ignores a forged record with path traversal', async () => {
    await store.ensureDirectory();
    const outside = path.join(temporary, 'outside.png'); await fs.writeFile(outside, image.data);
    await fs.writeFile(path.join(root, '.terminal-img-paste-forged.json'), JSON.stringify({ version: 1, file: '../outside.png', bytes: image.data.length, sha256: '0'.repeat(64), createdAt: new Date().toISOString() }));
    expect((await store.list()).images).toHaveLength(0);
    expect(await fs.readFile(outside)).toEqual(image.data);
  });
  it('does not create a directory merely to list images', async () => {
    expect(await store.list()).toEqual({ images: [], skipped: 0 });
    expect(await fs.readdir(temporary)).toEqual([]);
  });
});
