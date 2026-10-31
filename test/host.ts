import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pasteToTarget } from '../src/terminal';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('cacheqian.wsl-terminal-image-paste');
  assert.ok(extension, 'installed extension is visible');
  await extension.activate();
  const packagedSharp = createRequire(path.join(extension.extensionPath, 'package.json'))('sharp') as typeof import('sharp').default;
  const png = await packagedSharp({ create: { width: 3, height: 2, channels: 3, background: 'blue' } }).png().toBuffer();
  const decoded = await packagedSharp(png).raw().toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, 3);
  const commands = await vscode.commands.getCommands(true);
  for (const name of ['paste', 'openFolder', 'cleanup', 'diagnostics']) assert.ok(commands.includes(`wslImagePaste.${name}`));

  const output = new vscode.EventEmitter<string>();
  const input: string[] = [];
  let opened!: () => void;
  const ready = new Promise<void>(resolve => { opened = resolve; });
  const terminal = vscode.window.createTerminal({ name: 'Image paste host test A', pty: { onDidWrite: output.event, open: () => opened(), close: () => {}, handleInput: (data: string) => { input.push(data); } } });
  terminal.show(); await ready;
  const second = vscode.window.createTerminal({ name: 'Image paste host test B', pty: { onDidWrite: output.event, open() {}, close() {} } });
  try {
    await pasteToTarget({ alive: () => vscode.window.terminals.includes(terminal), sendText: (text, execute) => terminal.sendText(text, execute) }, async () => {
      second.show(); return '/tmp/terminal-img-paste-host.png';
    }, 'shell');
    const deadline = Date.now() + 5000;
    while (!input.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(input.join(''), "'/tmp/terminal-img-paste-host.png' ");
    assert.ok(!input.join('').includes('\r')); assert.ok(!input.join('').includes('\n'));
    console.log('PASS Extension Host: activation, packaged native image decoder, command registration, target terminal pinning, no Enter');
  } finally { terminal.dispose(); second.dispose(); output.dispose(); }
}
