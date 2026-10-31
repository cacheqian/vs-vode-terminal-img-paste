import { readFile } from 'node:fs/promises';
import { PasteError } from './errors';
import { run, type Runner } from './process';

export const MAX_BYTES = 20 * 1024 * 1024;
const messages: Record<string, string> = {
  NO_IMAGE: '剪贴板中没有图片，请先截图或复制图片。',
  MULTIPLE_FILES: '首版仅支持一张图片，请只复制一个图片文件。',
  UNSUPPORTED: '仅支持 PNG、JPEG、WebP 图片文件或剪贴板位图。',
  FILE_UNREADABLE: '无法读取复制的文件，请确认文件仍然存在且可以访问。',
  TOO_LARGE: '图片超过 20 MiB 限制。',
  TOO_MANY_PIXELS: '图片像素数量超过 2500 万限制。',
  CLIPBOARD_FAILED: 'Windows 剪贴板暂时不可读，请重新复制后重试。'
};

export function parseClipboardResponse(stdout: string): Buffer {
  let payload: unknown;
  try { payload = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); } catch { throw new PasteError('PROTOCOL', '剪贴板工具返回了无效结果。'); }
  if (!payload || typeof payload !== 'object' || !('ok' in payload)) throw new PasteError('PROTOCOL', '剪贴板工具返回了无效结果。');
  if (payload.ok !== true) {
    const code = 'code' in payload && typeof payload.code === 'string' ? payload.code : '';
    throw new PasteError(code in messages ? code : 'CLIPBOARD_FAILED', messages[code] ?? messages.CLIPBOARD_FAILED!);
  }
  if (!('data' in payload) || typeof payload.data !== 'string' || !payload.data.length || payload.data.length > Math.ceil(MAX_BYTES / 3) * 4 ||
      payload.data.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(payload.data)) {
    throw new PasteError('PROTOCOL', '图片数据无效或超过大小限制。');
  }
  const data = Buffer.from(payload.data, 'base64');
  if (!data.length || data.length > MAX_BYTES || data.toString('base64') !== payload.data) throw new PasteError('PROTOCOL', '图片数据无效或超过大小限制。');
  return data;
}

export async function readClipboard(executable: string, scriptPath: string, runner: Runner = run): Promise<Buffer> {
  const script = await readFile(scriptPath, 'utf8');
  const stdout = await runner(executable, ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], Math.ceil(MAX_BYTES / 3) * 4 + 65536);
  return parseClipboardResponse(stdout);
}
