import { PasteError } from './errors';
export type PathStyle = 'shell' | 'raw';
export function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => { const code = character.codePointAt(0)!; return code < 32 || (code >= 127 && code <= 159); });
}
export function formatPath(file: string, style: PathStyle): string {
  if (!file.startsWith('/') || hasControlCharacters(file)) throw new PasteError('PATH', '图片路径无效或包含终端控制字符。');
  return (style === 'raw' ? file : "'" + file.replace(/'/g, "'\\''") + "'") + ' ';
}

export class BusyGate {
  private busy = false;
  async perform<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new PasteError('BUSY', '正在处理图片，请等待当前操作完成。');
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
}

export interface PasteTarget { alive(): boolean; sendText(text: string, execute: boolean): void }
export async function pasteToTarget(target: PasteTarget, getSavedPath: () => Promise<string>, style: PathStyle): Promise<string> {
  if (!target.alive()) throw new PasteError('TERMINAL_CLOSED', '原终端已关闭。');
  const file = await getSavedPath();
  if (!target.alive()) throw new PasteError('TERMINAL_CLOSED', '原终端已关闭，图片已保留，可通过“打开图片目录”找到。');
  target.sendText(formatPath(file, style), false);
  return file;
}
