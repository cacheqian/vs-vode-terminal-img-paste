import { execFile } from 'node:child_process';
import { PasteError } from './errors';

export type Runner = (file: string, args: string[], maxBuffer: number) => Promise<string>;
export const run: Runner = (file, args, maxBuffer) => new Promise((resolve, reject) => {
  execFile(file, args, { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', maxBuffer, windowsHide: true }, (error, stdout) => {
    if (!error) { resolve(stdout); return; }
    // Do not include stderr: it may contain a copied filename or image payload.
    if (error.killed) reject(new PasteError('TIMEOUT', '读取超时，请检查 Windows PowerShell 和 WSL interop。'));
    else if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') reject(new PasteError('TOO_LARGE', '剪贴板返回内容超过大小限制。'));
    else reject(new PasteError('PROCESS_FAILED', '无法调用 Windows PowerShell，请运行“查看诊断”。'));
  });
});
