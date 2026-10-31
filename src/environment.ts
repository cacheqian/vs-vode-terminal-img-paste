import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { PasteError } from './errors';
import { run, type Runner } from './process';

export async function assertWsl(remoteName: string | undefined): Promise<void> {
  const kernel = await readFile('/proc/sys/kernel/osrelease', 'utf8').catch(() => '');
  if (process.platform !== 'linux' || remoteName !== 'wsl' || !/microsoft.*wsl2/i.test(kernel)) {
    throw new PasteError('ENVIRONMENT', '请在 Windows VS Code 通过 Remote - WSL 连接 WSL2 后使用此命令。');
  }
}

export async function findPowerShell(): Promise<string> {
  const candidates = (process.env.PATH ?? '').split(path.delimiter).filter(path.isAbsolute)
    .map(dir => path.join(dir, 'powershell.exe'));
  candidates.push('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe');
  for (const candidate of new Set(candidates)) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* try next path */ }
  }
  throw new PasteError('POWERSHELL_MISSING', '找不到 Windows PowerShell 5.1，请确认 Windows PATH 已传入 WSL 且 interop 已启用。');
}

export async function probePowerShell(executable: string, runner: Runner = run): Promise<string> {
  const result = await runner(executable, ['-NoProfile', '-NonInteractive', '-STA', '-Command', '$PSVersionTable.PSVersion.ToString()'], 4096);
  if (!/^5\.1\.\d+\.\d+$/.test(result.trim())) throw new PasteError('POWERSHELL_VERSION', '需要 Windows PowerShell 5.1。');
  return result.trim();
}
