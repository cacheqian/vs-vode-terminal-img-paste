import * as vscode from 'vscode';
import path from 'node:path';
import { assertWsl, findPowerShell, probePowerShell } from './environment';
import { readClipboard } from './clipboard';
import { validateImage } from './image';
import { ImageStore } from './storage';
import { BusyGate, pasteToTarget, type PathStyle } from './terminal';
import { errorMessage, PasteError, systemCode } from './errors';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('WSL Image Paste');
  context.subscriptions.push(output);
  const gate = new BusyGate();
  const report = (error: unknown) => {
    // Never log stdout, clipboard bytes or copied filenames.
    const message = errorMessage(error);
    output.appendLine(`${new Date().toISOString()} ${message} (${systemCode(error)})`);
    void vscode.window.showErrorMessage(`WSL Image Paste: ${message}`);
  };
  const ready = async () => {
    if (!vscode.workspace.isTrusted) throw new PasteError('TRUST', '请先信任当前工作区。');
    await assertWsl(vscode.env.remoteName);
  };
  const chooseStore = async (target?: vscode.Terminal): Promise<ImageStore | undefined> => {
    const config = vscode.workspace.getConfiguration('wslImagePaste');
    if (config.get('storage', 'global') === 'global') return new ImageStore(path.join(context.globalStorageUri.fsPath, 'images'));
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) throw new PasteError('WORKSPACE', '工作区存储模式需要打开文件夹，或在设置中切换为 global。');
    const cwd = target?.shellIntegration?.cwd;
    let folder = cwd ? vscode.workspace.getWorkspaceFolder(cwd) : undefined;
    if (!folder && folders.length === 1) folder = folders[0];
    if (!folder) folder = (await vscode.window.showQuickPick(folders.map(item => ({ label: item.name, description: item.uri.fsPath, folder: item })), { placeHolder: '选择保存图片的工作区（会产生 .terminal-images，不修改 .gitignore）' }))?.folder;
    return folder ? new ImageStore(path.join(folder.uri.fsPath, '.terminal-images')) : undefined;
  };
  const register = (id: string, callback: () => Promise<void>) => context.subscriptions.push(vscode.commands.registerCommand(id, () => callback().catch(report)));

  register('wslImagePaste.paste', async () => {
    // Capture synchronously, before ready(), UI prompts or reading the clipboard.
    const target = vscode.window.activeTerminal;
    if (!target) throw new PasteError('NO_TERMINAL', '请先聚焦一个 WSL2 终端。');
    await gate.perform(async () => {
      const started = Date.now();
      await ready();
      const store = await chooseStore(target);
      if (!store) return;
      const style = vscode.workspace.getConfiguration('wslImagePaste').get<PathStyle>('pathStyle', 'shell');
      const shell = (target.creationOptions as vscode.TerminalOptions).shellPath ?? process.env.SHELL ?? '';
      if (style === 'shell' && !/(^|\/)(ba|z)?sh$/.test(shell)) throw new PasteError('SHELL', '默认路径引用支持 Bash/Zsh。其他 CLI 可在确认其输入格式后使用 raw 模式。');
      let stage = 'clipboard';
      try {
        await pasteToTarget({ alive: () => vscode.window.terminals.includes(target) && target.exitStatus === undefined, sendText: (text, execute) => target.sendText(text, execute) }, async () => {
          const bytes = await readClipboard(await findPowerShell(), context.asAbsolutePath('resources/read-clipboard.ps1'));
          stage = 'validation';
          const image = await validateImage(bytes);
          stage = 'storage';
          const saved = await store.save(image);
          stage = 'terminal';
          return saved;
        }, style);
        vscode.window.setStatusBarMessage('图片已保存，已请求插入路径；可继续写指令', 4000);
        output.appendLine(`paste completed in ${Date.now() - started}ms; CLI image acceptance not verified`);
      } catch (error) {
        output.appendLine(`paste failed at ${stage} after ${Date.now() - started}ms`);
        throw error;
      }
    });
  });

  register('wslImagePaste.openFolder', async () => {
    await ready();
    const store = await chooseStore(vscode.window.activeTerminal);
    if (!store) return;
    await store.ensureDirectory();
    // vscode.openFolder would replace the user's workspace. Reveal the remote URI instead.
    const uri = vscode.env.remoteName ? context.globalStorageUri.with({ path: store.root }) : vscode.Uri.file(store.root);
    await vscode.commands.executeCommand('revealFileInOS', uri);
  });

  register('wslImagePaste.cleanup', async () => {
    await gate.perform(async () => {
      await ready();
      const store = await chooseStore(vscode.window.activeTerminal);
      if (!store) return;
      const { images, skipped } = await store.list();
      if (!images.length) { void vscode.window.showInformationMessage(`没有可确认归属的图片。跳过 ${skipped} 个异常记录。`); return; }
      const bytes = images.reduce((total, item) => total + item.bytes, 0);
      const choice = await vscode.window.showWarningMessage(`删除 ${images.length} 张插件图片（${(bytes / 1024 / 1024).toFixed(2)} MiB）？旧 CLI 会话中的路径将失效。目录：${store.root}。异常记录 ${skipped} 个将跳过。`, { modal: true }, '删除这些图片');
      if (choice !== '删除这些图片') return;
      const result = await store.remove(images);
      void vscode.window.showInformationMessage(`已删除 ${result.removed} 张图片；跳过 ${result.skipped + skipped} 项。用户文件不在清理范围内。`);
    });
  });

  register('wslImagePaste.diagnostics', async () => {
    output.show(true);
    output.appendLine(`\nWSL Image Paste ${context.extension.packageJSON.version as string}`);
    output.appendLine(`platform=${process.platform}; arch=${process.arch}; remote=${vscode.env.remoteName ?? 'local'}; trusted=${vscode.workspace.isTrusted}`);
    const config = vscode.workspace.getConfiguration('wslImagePaste');
    output.appendLine(`storage=${config.get('storage', 'global')}; global folder=${path.join(context.globalStorageUri.fsPath, 'images')}; pathStyle=${config.get('pathStyle', 'shell')}`);
    const terminalSettings = vscode.workspace.getConfiguration('terminal.integrated');
    const skipped = terminalSettings.get<string[]>('commandsToSkipShell', []);
    if (terminalSettings.get('sendKeybindingsToShell', false) || skipped.includes('-wslImagePaste.paste')) {
      output.appendLine('快捷键可能被发送给 CLI：请关闭 terminal.integrated.sendKeybindingsToShell，并将 wslImagePaste.paste 加入 commandsToSkipShell。');
    }
    output.appendLine('快捷键排查：使用 Developer: Toggle Keyboard Shortcuts Troubleshooting；图片粘贴命令应由 VS Code 处理。');
    await ready();
    const executable = await findPowerShell();
    output.appendLine(`PowerShell=${executable}; version=${await probePowerShell(executable)}`);
    output.appendLine('环境检查完成。诊断没有读取或修改剪贴板。自动清理：关闭（无此功能）。');
  });
}
