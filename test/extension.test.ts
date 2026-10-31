import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as VSCode from 'vscode';

const state = vi.hoisted(() => {
  const terminal = { creationOptions: { shellPath: '/bin/bash' }, exitStatus: undefined, sendText: vi.fn() };
  return {
    terminal, active: terminal, terminals: [terminal], handlers: new Map<string, () => Promise<void>>(),
    error: vi.fn(), status: vi.fn(), read: vi.fn(), save: vi.fn(), ready: vi.fn(), confirm: vi.fn(), remove: vi.fn(),
    style: 'shell', trusted: true,
  };
});
vi.mock('vscode', () => ({
  window: {
    get activeTerminal() { return state.active; }, get terminals() { return state.terminals; },
    createOutputChannel: () => ({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() }),
    showErrorMessage: state.error, setStatusBarMessage: state.status, showWarningMessage: state.confirm,
    showInformationMessage: vi.fn(),
  },
  workspace: { get isTrusted() { return state.trusted; }, getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'pathStyle' ? state.style : fallback }) },
  env: { remoteName: 'wsl' },
  commands: { registerCommand: (id: string, handler: () => Promise<void>) => { state.handlers.set(id, handler); return { dispose() {} }; } },
}));
vi.mock('../src/environment', () => ({ assertWsl: state.ready, findPowerShell: async () => '/windows/powershell.exe', probePowerShell: async () => '5.1' }));
vi.mock('../src/clipboard', () => ({ readClipboard: state.read }));
vi.mock('../src/image', () => ({ validateImage: async (data: Buffer) => ({ data, extension: 'png' }) }));
vi.mock('../src/storage', () => ({ ImageStore: class {
  root = '/images'; save = state.save; remove = state.remove;
  list = async () => ({ images: [{ bytes: 100 }], skipped: 0 });
} }));
import { activate } from '../src/extension';

beforeEach(() => {
  vi.clearAllMocks();
  state.active = state.terminal; state.terminals = [state.terminal]; state.style = 'shell'; state.trusted = true;
  state.read.mockResolvedValue(Buffer.from('image')); state.save.mockResolvedValue('/images/terminal-img-paste-test.png'); state.ready.mockResolvedValue(undefined);
  activate({ subscriptions: [], globalStorageUri: { fsPath: '/global' }, asAbsolutePath: (file: string) => `/extension/${file}` } as unknown as VSCode.ExtensionContext);
});

describe('registered commands', () => {
  it('captures target before awaiting environment validation', async () => {
    const other = { ...state.terminal, sendText: vi.fn() };
    state.ready.mockImplementationOnce(async () => { state.active = other; state.terminals.push(other); });
    await state.handlers.get('wslImagePaste.paste')!();
    expect(state.terminal.sendText).toHaveBeenCalledWith("'/images/terminal-img-paste-test.png' ", false);
    expect(other.sendText).not.toHaveBeenCalled();
  });
  it('retains a saved image when its target closes and does not announce success', async () => {
    state.save.mockImplementationOnce(async () => { state.terminals = []; return '/images/file.png'; });
    await state.handlers.get('wslImagePaste.paste')!();
    expect(state.terminal.sendText).not.toHaveBeenCalled(); expect(state.status).not.toHaveBeenCalled();
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('已保留'));
  });
  it('does not save or send on clipboard failure', async () => {
    state.read.mockRejectedValueOnce(new Error('unreadable'));
    await state.handlers.get('wslImagePaste.paste')!();
    expect(state.save).not.toHaveBeenCalled(); expect(state.terminal.sendText).not.toHaveBeenCalled();
  });
  it('does not read clipboard in an untrusted workspace', async () => {
    state.trusted = false;
    await state.handlers.get('wslImagePaste.paste')!();
    expect(state.read).not.toHaveBeenCalled(); expect(state.error).toHaveBeenCalled();
  });
  it('uses raw mode only when selected and still never submits', async () => {
    state.style = 'raw';
    await state.handlers.get('wslImagePaste.paste')!();
    expect(state.terminal.sendText).toHaveBeenCalledWith('/images/terminal-img-paste-test.png ', false);
  });
  it('does not delete images when cleanup confirmation is dismissed', async () => {
    state.confirm.mockResolvedValueOnce(undefined);
    await state.handlers.get('wslImagePaste.cleanup')!();
    expect(state.confirm).toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled();
  });
});
