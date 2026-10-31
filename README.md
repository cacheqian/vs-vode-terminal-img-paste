# WSL Terminal Image Paste

在 **Windows VS Code → Remote - WSL2 → 集成终端中的 CLI** 里粘贴截图。

按 `Ctrl+Alt+V` 后，插件读取 Windows 剪贴板，将图片保存到 WSL2，并向原终端插入 **Linux 绝对路径和一个空格**。你可以直接继续写指令；插件不按回车、不提交输入。

## 安装与使用

1. 在 Windows VS Code 中通过 Remote - WSL 打开 WSL2，确认左下角显示 WSL 连接。
2. 下载本项目的 VSIX。在命令面板运行 **Extensions: Install from VSIX...**，选择文件，并确认扩展安装在 **WSL: 你的发行版** 一侧。
3. 在集成终端启动支持读取图片路径的 CLI。
4. Windows 截图或复制一个 PNG、JPEG、WebP 文件，回到终端按 `Ctrl+Alt+V`。
5. 接着写指令，完成后按你平时的方式提交。

不需要另外安装本项目的 CLI、后台服务、Python 或图片命令行工具。插件自带图片校验依赖。需要 Windows PowerShell 5.1 和 WSL interop 可用。

当前产物针对 **Linux x64 / glibc 的 WSL2** 打包，VS Code 最低版本 1.99。ARM64 可在对应 Linux 环境按相同流程构建；尚未实机验证，不要在 ARM64 安装 x64 VSIX。

源码在 [main](https://github.com/cacheqian/vs-vode-terminal-img-paste/tree/main)，CI 构建成功后可在 [Actions](https://github.com/cacheqian/vs-vode-terminal-img-paste/actions) 的运行记录中下载 VSIX artifact。尚未发布到 Marketplace。

## 图片保存

- 默认所有项目共用 WSL 端本插件的 `globalStorageUri/images` 目录；**查看诊断**会显示实际路径。
- 文件名为 `terminal-img-paste-UTC时间戳-UUID.png`（复制 JPEG、WebP 时保持对应格式）。
- 历史图片持续保留，没有自动清理任务、数量限制清理或退出清理。
- 不修改 `.gitignore`、Bash 启动文件或剪贴板内容，不上传图片。
- 每张图片有隐藏的 `.图片文件名.json` 归属记录；手动清理只处理记录与内容匹配的图片，其他文件不动。

## 命令与配置

命令面板中的 `WSL Image Paste` 命令：粘贴图片路径、打开图片目录、手动清理图片、查看诊断。手动清理会先显示数量和大小，确认后删除；旧会话的图片路径可能因此失效。

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| `wslImagePaste.storage` | `global` | 统一目录；`workspace` 将图片存入选定项目的 `.terminal-images`，适合限制工作区外读取的 CLI |
| `wslImagePaste.pathStyle` | `shell` | Bash/Zsh 引号；`raw` 插入未加引号的绝对路径，供自行解析路径的交互式 CLI 使用 |

多根工作区使用 workspace 模式时，优先使用目标终端可识别的所属工作区；无法确定时显示选择器。此模式会产生项目文件，但不会自动添加 Git 忽略规则。

## Claude Code 与 Codex CLI

目标是让两者使用同一个粘贴入口。插件仅插入路径，不调用 CLI 的私有附件协议，也不会运行另一个 AI 命令。

路径显示在输入处，不等于 CLI 已经读到图片。如果 CLI 没有识别带引号路径，可试用 `raw`；如果 CLI 的沙箱不允许读取默认目录，可使用 `workspace`。具体版本的交互式图片识别仍需实测，不能由终端测试代替。[验证记录](docs/VALIDATION.md)区分已测和待测部分。

## 快捷键没有生效

先用命令面板运行“粘贴图片路径”，区分快捷键冲突与读取失败。运行“查看诊断”检查环境。

如果按键被送给 CLI，可在 VS Code 设置里将 `terminal.integrated.sendKeybindingsToShell` 关闭，并把 `wslImagePaste.paste` 添加到现有 `terminal.integrated.commandsToSkipShell` 数组中，保留其他配置。也可以在键盘快捷键界面重新绑定命令；不要用 Bash alias 替代插件入口。

## 支持边界

- 单次一张静态图片，最大 20 MiB、2500 万像素；多文件、动画图片和损坏图片会提示错误。
- 首版仅支持已连接 WSL2 的 VS Code 窗口。SSH、容器、Windows 本地窗口里手动启动 WSL 等模式未纳入支持。
- 默认路径引用支持 Bash/Zsh；终端前台 CLI 的图片解析能力需要分别验收。
- 切换焦点后仍发送到最初的终端；原终端关闭时保留已保存图片并提示，不改投其他终端。
- 同一窗口内忙时拒绝重复请求；多个窗口保存采用随机文件名和独占创建，不覆盖旧图片。

## 开发与打包

```bash
npm ci
npm run check
npm run test:host
npm run test:interop
npm run package
```

`test:host` 使用独立 VS Code 测试宿主；无桌面环境可用 `xvfb-run -a npm run test:host`。`test:interop` 仅在 WSL 中运行，使用 Windows 内存 IDataObject 与自建文件验证 PowerShell 脚本，**不会替换用户的系统剪贴板**。打包产物位于 `artifacts/`。

`sharp` 和对应平台的原生库随 VSIX 一起发布；因此应在与目标相同的 Linux 架构上打包。运行时不下载依赖。

## 参考与许可

本项目参考了 [BatthewZ/terminal-img-paste](https://github.com/BatthewZ/terminal-img-paste) 的功能思路及源码审查结果，核心实现重新编写。重点避免保存后才检查路径、误删最新图片、修改 `.gitignore` 外部链接和切换终端误发等问题。

本项目使用 MIT 许可。运行依赖及原生库的第三方许可证随依赖包一起分发。
