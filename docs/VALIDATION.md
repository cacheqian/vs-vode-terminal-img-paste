# 0.1.0 验证记录

本记录区分组件测试、真实系统接口测试与完整用户交互，避免把“路径插入成功”当成“CLI 已识别图片”。

## 环境

- WSL2 x86_64，Linux 内核 6.6.87.2-microsoft-standard-WSL2。
- 开发 Node.js 24.18.0；VS Code 测试宿主 1.144.0。
- Windows PowerShell 5.1.26100.9711，WSL interop 可用。
- 本机可执行程序版本：Claude Code 2.1.269、Codex CLI 0.145.0。仅确认版本，不表示已完成其交互式图片识别测试。

## 已验证

| 检查 | 结果与证据范围 |
| --- | --- |
| TypeScript、ESLint、构建 | 通过，使用 `npm run check` |
| 单元与真实文件系统测试 | 37 项通过；覆盖协议与数据上限、PNG/JPEG/WebP 完整解码、损坏图片、特殊路径、终端关闭和切换、并发保存、保留 25 张历史图片、目录符号链接、损坏或伪造归属记录、修改后的文件、清理取消与确认范围 |
| Windows PowerShell 互操作 | 调用真实 Windows PowerShell，通过内存 IDataObject 和自建文件测试空剪贴板类型、多文件拒绝、位图转 PNG、PNG/JPEG/WebP 文件读取；中文、空格、单引号路径正确，原始文件字节保持不变 |
| 当前系统剪贴板只读检查 | 实际调用脚本返回 `NO_IMAGE`，说明当时没有图片；未覆盖真实截图的成功路径 |
| 隔离 VS Code Extension Host | 扩展激活、命令注册、PTY 终端 API 接收路径、切换焦点后发回原终端、不包含 CR/LF 通过 |
| VSIX 包验证 | 从 VSIX 解包后的目录启动扩展，成功加载并运行随包分发的原生图片解码器，终端 API 测试通过；不依赖开发目录中的 sharp 包 |
| 运行依赖审计 | 开发时 `npm audit --omit=dev` 返回 0 项已知漏洞；仅代表当时依赖数据库结果 |

互操作测试不会往用户系统剪贴板写入数据。测试用的是 Windows 内存对象，因此“真实系统剪贴板截图 → 用户 Remote - WSL 窗口 → CLI 图片识别”仍须单独验证。

VS Code 宿主测试运行在 WSL 的独立 Linux VS Code 实例中，使用 PTY 测试终端。它验证真实 VS Code API 和安装包依赖，不等同于用户 Windows VS Code 的 Remote - WSL 连接与快捷键实测。

## 待用户环境验收

1. 将 VSIX 安装到 Windows VS Code 的 WSL2 扩展侧。
2. Windows 截取一张不含敏感信息的图片；在 Claude Code 输入区域按 `Ctrl+Alt+V`，确认不提前提交、可续写指令，随后确认 CLI 能描述图片。
3. 在 Codex CLI 重复，记录默认 `shell` 模式是否被识别；必要时切换 `raw`。分别记录默认目录是否被沙箱允许。
4. 粘贴过程中切换终端、关闭原终端，检查路径没有误发。
5. 检查“打开图片目录”和真实键盘快捷键；若快捷键被 CLI 接收，按 README 排查转发设置。

以上未完成项不影响源码与安装包交付，但不能宣称两个 CLI 已完成端到端兼容验收。

## 复现命令

```bash
npm ci
npm run check
npm run test:interop
npm run package
npm run test:host -- --packaged
```

CI 在 Linux x64 执行自动检查、隔离宿主测试、打包和包内宿主测试；Windows 互操作只在 WSL2 环境运行。ARM64 尚未实机验证。
