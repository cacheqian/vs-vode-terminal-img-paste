import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
// A shell launched by VS Code can inherit this flag; the test executable must run as Electron.
delete process.env.ELECTRON_RUN_AS_NODE;
await build({ entryPoints: ['test/host.ts'], outfile: 'dist/host-test.js', bundle: true, platform: 'node', format: 'cjs', external: ['vscode'] });
let unpacked;
try {
  let extensionDevelopmentPath = process.cwd();
  if (process.argv.includes('--packaged')) {
    unpacked = await mkdtemp(path.join(os.tmpdir(), 'wsl-image-vsix-'));
    execFileSync('unzip', ['-q', `artifacts/wsl-terminal-image-paste-0.1.0-linux-${process.arch}.vsix`, '-d', unpacked]);
    extensionDevelopmentPath = path.join(unpacked, 'extension');
  }
  await runTests({
    extensionDevelopmentPath, extensionTestsPath: path.resolve('dist/host-test.js'),
    launchArgs: ['--no-sandbox', '--disable-gpu', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
  });
} finally { if (unpacked) await rm(unpacked, { recursive: true, force: true }); }
