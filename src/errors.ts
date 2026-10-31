export class PasteError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'PasteError'; }
}
export function errorMessage(error: unknown): string {
  return error instanceof PasteError ? `[${error.code}] ${error.message}` : '操作失败，请检查目录权限、磁盘空间及诊断信息。';
}
export function systemCode(error: unknown): string {
  return error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
}
