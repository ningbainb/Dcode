# Dcode Agent 插件：浏览器与电脑控制

## 产品规则

设置侧边栏的“插件”管理当前 Dcode/DSH Agent 真正可调用的工具。浏览器控制采用 Microsoft Playwright MCP；Windows 电脑控制采用 `windows-gui-mcp`（基于 pywinauto）。两个能力默认关闭，分别启用，不因进入设置页或打开项目而自动授予桌面控制。

上游来源与许可：[Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)（Apache-2.0）、[windows-gui-mcp](https://github.com/dcl632/windows-gui-mcp)（MIT）、[pywinauto](https://github.com/pywinauto/pywinauto)（BSD-3-Clause）。Playwright MCP 随 Dcode 运行时一起打包；Windows GUI MCP 当前为 0.1.0 早期版本，首次点击安装时从 PyPI 下载到 Dcode 专用虚拟环境。它目前依赖 MCP Python SDK 1.x 的 `Server.list_tools` 接口，因此安装时固定 `mcp==1.30.0`；MCP 2.x 会导致该服务无法启动。Dcode 不复制或修改它们的上游源码。

浏览器控制当前仅在 Windows 上开放，使用本机 Edge 的独立自动化会话；它不继承 Dcode 内置浏览器或用户日常浏览器的 Cookie。电脑控制只在 Windows 本地桌面上展示启用入口，依赖本机 Python 3.12+ 和首次安装的独立虚拟环境。下载/安装失败时保持关闭。Linux、macOS 和远程工作区不得宣称电脑控制可用。开关关闭后新会话不再收到相应 MCP 工具。

## 状态与边界

`DshBackend` 是启用状态的唯一所有者，持久化在 Dcode 自己的数据目录；UI 只读取并提交命令。DSH profile 的 `cordis.patch.yml` 中只有 Dcode 标记的区域由 Dcode 生成，其他配置保留。设置提交顺序为：验证依赖 → 原子保存状态 → 更新 profile 中的托管 MCP 行 → 重启 DSH → 返回新状态。失败时不能把尚未加载的能力标成已启用。

```text
设置开关 → IDshService → DshBackend 状态文件
                         ↓
                  DSH profile 托管 MCP 行
                         ↓
                  DSH 重启 / MCP 工具发现
                         ↓
                  新会话可调用 mcp__browser__* / mcp__windows_gui__*
```

已经运行的 Agent turn 可能在重启时中断；设置页在提交前提示这一点。Dcode 不代替 MCP 服务器做点击结果判断；DSH 原有权限和审批语义仍然生效。第三方页面和桌面内容视为不可信输入。

## 验收

1. 设置侧边栏可直接打开“插件”；Dcode 模式显示 DSH 插件，而不是 ZCode 旧 Agent 的插件列表。
2. 默认两个开关关闭；重启应用后状态保持。
3. 启用浏览器后，DSH profile 出现唯一 Playwright MCP 行，Agent 可发现浏览器工具；关闭后行消失。
4. Windows 电脑控制未安装依赖时说明前置条件；安装失败不写入启用状态。成功后启用，Agent 可发现窗口/UIA 操作工具。
5. 重复开关或重启不产生重复行；保留用户自己写的 profile patch；其他平台隐藏/禁用 Windows 控制。
