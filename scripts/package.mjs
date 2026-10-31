import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw new Error('Build the VSIX on Linux x64 or arm64 to include matching sharp binaries.');
mkdirSync('artifacts', { recursive: true });
execFileSync('node_modules/.bin/vsce', ['package', '--target', `linux-${process.arch}`, '--out', `artifacts/wsl-terminal-image-paste-0.1.0-linux-${process.arch}.vsix`], { stdio: 'inherit' });
