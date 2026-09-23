# Dcode 桌面端跨平台适配计划

当前交付与验收范围是 Windows x64。macOS 和 Linux 是后续目标；仓库中已有 Electron Builder 的对应目标配置，但尚未构成可安装、可更新、可验收的 Dcode 发行版。

当前 DSH 会话、图片与文件上传使用运行时协议，没有在消息格式中写入 Windows 路径；它们可以作为跨平台共用层。平台适配的主要缺口在运行时部署、原生模块、插件与发行流程，不能仅凭界面可构建就宣称支持。

## 先补齐共同构建链路

1. DSH 物理运行时部署目录与就绪标记已按操作系统、CPU 架构、DSH 版本和锁文件摘要隔离。后续跨平台打包仍须验证实际 Node 可执行文件与原生模块是否匹配目标平台。
2. 将 Dcode 的 `pack:dcode`、产物验证和 release 清单改成按平台选目标与文件名。当前命令固定 `--win --x64`，验证脚本检查的是 Windows NSIS、`latest.yml` 和 `win-unpacked` 路径。
3. `afterPack` 已按平台定位 `app.asar` 与 DSH runtime：macOS 位于 `.app/Contents/Resources`，Windows/Linux 位于 `resources`；Windows 的可执行文件品牌处理只在 Windows 执行。仍须用对应系统的真实打包产物验证路径与内容。
4. 按各平台重新部署和验证 Node、DSH、`node-pty` 等原生依赖，不复用 Windows 的预构建 runtime。用实际安装后的应用做启动、会话、终端、文件工具和插件烟测。
5. 自动更新分别验证 Windows、macOS、Linux 的发布元数据、下载与重启安装。发布前检查应用身份、签名要求和升级路径，避免把“能构建”当作“能自动更新”。
6. 浏览器操控当前在 `agent-plugins.mjs` 中仅对 Windows/Edge 开放；macOS/Linux 需验证 Playwright MCP 与本地 Chromium 的打包、启动及权限。Windows GUI MCP 不能直接迁移，需分别选定并验证系统级 Computer Use 后端，界面应显示平台能力差异。

## 平台验收

| 平台 | 首批目标 | 必须通过的检查 |
| --- | --- | --- |
| macOS | Apple Silicon 与 Intel 原生构建；DMG/ZIP | 安装/启动、DSH 运行时、权限提示、终端、浏览器/Computer Use、更新；正式分发前完成签名与公证 |
| Linux | x64 起步；优先 AppImage、deb，其他格式按维护能力决定 | 主流桌面环境的安装/启动、DSH 运行时、原生依赖、沙箱与文件权限、终端、更新 |

跨平台实现必须保持现有 Dcode 设置、任务和文件界面的一致性；系统权限和原生安装行为则按平台实际规则处理。每个平台只有在原生机器或可信的对应系统 CI 上完成打包及安装后验收，才进入公开支持列表。
