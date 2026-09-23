# Dcode 与 DeepSeek Harness 的融合

Dcode 将 ZCode 的桌面工作区能力与 DeepSeek Harness（DSH）的 Agent 执行能力连接起来。这里的「融合」指同一项目里的任务、消息、工具结果与文件工作区使用同一条真实执行链路，不只是换图标或嵌入一个独立聊天窗口。

```mermaid
flowchart LR
  UI[项目 / 任务列表 / 聊天界面] --> S[DSH 服务适配层]
  S --> R[本地 DSH Runtime]
  R --> M[模型 / 会话 / 工具 / 权限]
  R --> S
  S --> UI
  UI --> W[文件 / 终端 / Git Diff]
```

DSH 是会话、消息、模型执行、工具调用和权限请求的事实来源。桌面服务层管理 DSH 的启动、停止、重启、健康检查和事件转发；UI 只保存当前工作区选择的会话 ID，并把 DSH 事件投影为聊天消息与执行记录。左侧任务列表和聊天面板共享该 ID，不创建第二套独立的聊天历史。切换项目时，旧项目迟到的响应不能写入新项目；应用或运行时重启后从 DSH 会话恢复。

文件操作与命令执行由 DSH 工具完成，Dcode 原有文件、终端和 Git/Diff 界面用于查看真实文件状态。工具卡片展示执行目标、状态及输出，文件变化仍应以磁盘和 Git Diff 为准。GitHub 云备份由独立服务负责，按项目当前磁盘内容制作快照，不依赖模型的口头声明。

当前桌面功能在 Windows 打包应用里用本地合成模型夹具通过了双会话、项目切换、重启恢复、停止继续、工具输出、文件编辑、Diff 和终端验收。这个测试证明桌面到运行时的本地链路，不证明某个在线模型账号或所有提供商已经实测。[模型供应商设置](DSH-MODEL-PROVIDER-SETTINGS.md) 复用 ZCode 的交互语言并保存到 DSH Profile。Dcode 的 MCP 设置由 DSH Profile 托管，详见 [MCP 接入](DSH-MCP-SERVERS.md)。ZCode 工作区、用户级 `.zcode/skills` 和已启用插件贡献的 Markdown 技能已通过 [DSH 技能提供器](DSH-ZCODE-SKILLS.md) 接入；已启用的 ZCode Markdown 自定义命令也可在 DSH 会话输入框调用，详见 [命令接入](DSH-ZCODE-COMMANDS.md)。本地桌面的设置侧边栏保留对应的“技能”“命令”管理入口，写入同一份 ZCode 文件和启用配置。[子智能体设置](DSH-SUBAGENTS.md) 控制 DSH 原生委派深度。插件的其他组件及 ZCode 的记忆、自定义子智能体文件、自动化和钩子设置尚未逐项验证能控制 DSH 执行，本地 DSH 工作区不把它们宣传为已贯通能力。

实现与契约可从 [DSH 运行时](../packages/dsh-runtime/CONTRACT.md)、[工作区会话](../packages/ui/src/dsh/CONTRACT.md) 和 [云备份](../packages/services/src/cloud-backup/CONTRACT.md) 开始阅读。移植代码的上游修订与许可证见 [PROVENANCE.md](../packages/dsh-runtime/vendor/PROVENANCE.md)。

内核依赖统一固定到 `@deepseek-ai/dsh`、`dsh-base`、`dsh-mcp-client`、`dsh-web-app` 同一发布版本 `0.1.7-alpha.2`。Dcode 只使用项目锁文件和打包内容中的内核，不自动混用用户全局安装的 DSH。版本升级需要同时验证 Profile 启动、设置读写、模型目录、会话请求、插件桥接与桌面打包；若上游协议变更，先适配桥接层再交付。
Windows 安装包的物理 runtime 部署目录由 DSH 包版本与锁文件摘要共同命名。构建脚本与 electron-builder 使用同一个路径解析函数；依赖变化时创建新目录，而不是复用旧 `.dcode-deploy-ready` 标记。打包验证必须读取物理 runtime 中四个 DSH 直连包的实际版本并与项目清单一致。
运行时验证必须从 Dcode 适配器的真实模块解析路径读取 `@deepseek-ai/dsh/package.json`，不能仅凭锁文件或根目录的包版本判断。0.1.7 的 app-boot 不再导出旧的 Profile module-fallback 修复函数，改由启动时创建不可变的 runtime resolution，并在 `boot` 期间挂载 `PluginPackages` 服务；Dcode launcher 复用这条上游启动路径。缺少该服务时插件会集体加载失败，不能以只通过静态类型检查视为升级完成。
0.1.7 的浏览器令牌兑换仍返回带 session cookie 的 HTTP 303，但 `Location` 变为相对路径 `./`。就绪探测只接受 `./` 或 `/` 这两个首页重定向，并要求响应携带 cookie；跳转状态本身不足以证明运行时已就绪。
在当前 Windows 非管理员账户上，0.1.7-alpha.2 默认 `workspace-write` PowerShell 沙箱调用 `SetNamedSecurityInfoW` 给工作区写入 ACL 时返回 Win32 5。全新测试目录也复现；仅测试进程设置 `DSH_PERMISSION_MODE=danger-full-access` 后 Shell E2E 通过。Dcode 生产 Profile 不自动关闭沙箱，此上游兼容问题解决前不发布包含该内核的新 Windows 安装包。
