// Uses Windows IDataObject fixtures instead of replacing the user's clipboard.
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import sharp from 'sharp';
const require = createRequire(import.meta.url);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'wsl-interop-'));
try {
  const output = path.join(temporary, 'interop.cjs');
  await build({ stdin: { contents: "export * from './src/environment'; export * from './src/clipboard'; export * from './src/process'; export * from './src/image';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', external: ['sharp'], outfile: output });
  // Resolve the packaged image decoder from this development checkout only for this test harness.
  const { createRequire: makeRequire } = await import('node:module');
  const Module = require('node:module');
  const m = new Module(output); m.filename = output; m.require = name => makeRequire(path.join(process.cwd(), 'package.json'))(name);
  m._compile(await readFile(output, 'utf8'), output);
  const core = m.exports;
  const executable = await core.findPowerShell();
  console.log('Windows PowerShell:', await core.probePowerShell(executable));
  const source = await readFile('resources/read-clipboard.ps1', 'utf8');
  const anchor = '$snapshot = [System.Windows.Forms.Clipboard]::GetDataObject()';
  const call = async fixture => JSON.parse(await core.run(executable, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(source.replace(anchor, fixture), 'utf16le').toString('base64')], 29 * 1024 * 1024));
  const noImage = await call('$snapshot = New-Object System.Windows.Forms.DataObject');
  assert.equal(noImage.code, 'NO_IMAGE');
  const multiple = await call('$snapshot = New-Object System.Windows.Forms.DataObject; $snapshot.SetData([System.Windows.Forms.DataFormats]::FileDrop, [string[]]@(\'a.png\', \'b.png\'))');
  assert.equal(multiple.code, 'MULTIPLE_FILES');
  const png = await sharp({ create: { width: 4, height: 3, channels: 3, background: 'blue' } }).png().toBuffer();
  const bitmap = await call(`$snapshot = New-Object System.Windows.Forms.DataObject; $inputBytes = [Convert]::FromBase64String('${png.toString('base64')}'); $inputStream = New-Object System.IO.MemoryStream(,$inputBytes); $bitmap = [System.Drawing.Image]::FromStream($inputStream); $snapshot.SetData([System.Windows.Forms.DataFormats]::Bitmap, $bitmap)`);
  const decoded = await core.validateImage(core.parseClipboardResponse(JSON.stringify(bitmap)));
  assert.equal(decoded.width, 4); assert.equal(decoded.height, 3);
  // File-drop fixtures live in our own WSL test directory, accessed by Windows through wslpath.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  for (const format of ['png', 'jpeg', 'webp']) {
    const bytes = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'red' } }).toFormat(format).toBuffer();
    const file = path.join(temporary, `中文 space ' test.${format}`); await writeFile(file, bytes);
    const { stdout } = await promisify(execFile)('wslpath', ['-w', file]);
    const encodedPath = Buffer.from(stdout.trim(), 'utf16le').toString('base64');
    const response = await call(`$snapshot = New-Object System.Windows.Forms.DataObject; $filePath = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedPath}')); $snapshot.SetData([System.Windows.Forms.DataFormats]::FileDrop, [string[]]@($filePath))`);
    const image = await core.validateImage(core.parseClipboardResponse(JSON.stringify(response)));
    assert.deepEqual(image.data, bytes);
    console.log(`PASS Windows file-drop ${format}, Unicode/space/apostrophe path, original bytes preserved`);
  }
  console.log('PASS Windows IDataObject: empty, multiple files, bitmap; actual clipboard left untouched');
} finally { await rm(temporary, { recursive: true, force: true }); }
