import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { parseClipboardResponse, readClipboard, MAX_BYTES } from '../src/clipboard';
import { validateImage } from '../src/image';
import { BusyGate, formatPath, pasteToTarget } from '../src/terminal';
import { execFileSync } from 'node:child_process';

describe('clipboard protocol', () => {
  it('handles a bounded success response and never treats errors as empty clipboard', () => {
    expect(parseClipboardResponse('{"ok":true,"data":"aGVsbG8="}').toString()).toBe('hello');
    for (const code of ['NO_IMAGE', 'MULTIPLE_FILES', 'FILE_UNREADABLE', 'TOO_LARGE', 'UNSUPPORTED', 'CLIPBOARD_FAILED']) {
      expect(() => parseClipboardResponse(JSON.stringify({ ok: false, code }))).toThrow(expect.objectContaining({ code }));
    }
  });
  it.each(['', 'profile banner\n{}', '{}', 'null', '{"ok":true,"data":"aGVsbG8===!"}', '{"ok":true,"data":""}', '{"ok":true,"data":"YR=="}'])('rejects malformed output %s', value => {
    expect(() => parseClipboardResponse(value)).toThrow();
  });
  it('handles multi-MiB input without regexp stack overflow and rejects excessive data', () => {
    const bytes = Buffer.alloc(4 * 1024 * 1024, 17);
    expect(parseClipboardResponse(JSON.stringify({ ok: true, data: bytes.toString('base64') }))).toEqual(bytes);
    expect(() => parseClipboardResponse(JSON.stringify({ ok: true, data: Buffer.alloc(MAX_BYTES + 1).toString('base64') }))).toThrow();
  });
  it('executes exactly one fixed script with no profile and STA', async () => {
    let count = 0;
    const data = await readClipboard('/windows/powershell.exe', 'resources/read-clipboard.ps1', async (file, args, limit) => {
      count++;
      expect(file).toBe('/windows/powershell.exe');
      expect(args.slice(0, 4)).toEqual(['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand']);
      expect(Buffer.from(args[4]!, 'base64').toString('utf16le')).toContain('GetDataObject');
      expect(limit).toBeGreaterThan(MAX_BYTES);
      return '{"ok":true,"data":"aGVsbG8="}';
    });
    expect(count).toBe(1); expect(data.toString()).toBe('hello');
  });
});

describe('image decoding', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('fully decodes %s and preserves original bytes', async format => {
    const data = await sharp({ create: { width: 2, height: 3, channels: 3, background: '#236aff' } }).toFormat(format).toBuffer();
    const result = await validateImage(data);
    expect(result).toMatchObject({ width: 2, height: 3, extension: format === 'jpeg' ? 'jpg' : format });
    expect(result.data).toEqual(data);
  });
  it('rejects a forged signature, truncated image and unsupported SVG', async () => {
    const data = await sharp({ create: { width: 3, height: 3, channels: 3, background: 'red' } }).png().toBuffer();
    for (const candidate of [data.subarray(0, 8), data.subarray(0, data.length / 2), Buffer.from('<svg/>'), Buffer.alloc(0)]) {
      await expect(validateImage(candidate)).rejects.toThrow();
    }
  });
});

describe('terminal insertion', () => {
  it('quotes spaces, Unicode, shell metacharacters and a single quote without execution', () => {
    const file = "/tmp/中文 space/'$(echo forbidden)`echo unsafe`$HOME.png";
    const text = formatPath(file, 'shell');
    // Let a real shell parse the argument; printf must receive exactly the original path.
    const result = execFileSync('/bin/bash', ['--noprofile', '--norc', '-c', `printf '%s' ${text}`], { encoding: 'utf8' });
    expect(result).toBe(file); expect(text.endsWith(' ')).toBe(true);
    expect(formatPath(file, 'raw')).toBe(file + ' ');
  });
  it.each(['/tmp/a\nb.png', '/tmp/a\rb.png', '/tmp/\x1b[31m.png', '/tmp/\x9b.png', '../x.png'])('rejects unsafe path', file => expect(() => formatPath(file, 'raw')).toThrow());
  it('pins the original target across async operations and never appends Enter', async () => {
    const a: unknown[] = [], b: unknown[] = [];
    let active = { alive: () => true, sendText: (...args: unknown[]) => { a.push(args); } };
    await pasteToTarget(active, async () => {
      active = { alive: () => true, sendText: (...args: unknown[]) => { b.push(args); } };
      return '/tmp/image.png';
    }, 'shell');
    expect(a).toEqual([["'/tmp/image.png' ", false]]); expect(b).toEqual([]);
  });
  it('does not send to a closed terminal after saving', async () => {
    let alive = true; let sent = false;
    await expect(pasteToTarget({ alive: () => alive, sendText: () => { sent = true; } }, async () => { alive = false; return '/tmp/image.png'; }, 'raw')).rejects.toThrow(/已保留/);
    expect(sent).toBe(false);
  });
  it('rejects repeated requests without queueing and releases after failure', async () => {
    const gate = new BusyGate();
    let release!: () => void;
    const pending = gate.perform(() => new Promise<void>(resolve => { release = resolve; }));
    await expect(gate.perform(async () => 'duplicate')).rejects.toThrow(/正在处理/);
    release(); await pending;
    await expect(gate.perform(async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    expect(await gate.perform(async () => 'ok')).toBe('ok');
  });
});
