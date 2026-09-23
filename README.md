<div align="center">
  <img src="docs/assets/dcode-icon.png" alt="Dcode 图标" width="112" />
  <h1>Dcode</h1>
  <p>把代码工作区、DeepSeek Harness Agent 与 GitHub 私有快照备份放在同一款桌面应用里。</p>
  <p><a href="README.en.md">English</a> · <a href="docs/CLOUD-BACKUP.md">云备份指南</a> · <a href="docs/DSH-INTEGRATION.md">DSH 融合说明</a> · <a href="CONTRIBUTING.md">参与贡献</a></p>
</div>

![Dcode 桌面工作区](docs/assets/desktop-workspace.png)

Dcode 是基于 [ZCode](https://github.com/zai-org/ZCode) 改造的开源 AI Coding Workspace。桌面端以 [DeepSeek Harness](https://github.com/ningbainb/deepseek-harness-desktop) 作为本地 Agent 运行时：在一个项目里发起任务、阅读和修改文件、运行命令、查看工具执行记录与 Git Diff，并从左侧继续历史会话。Dcode 是独立衍生项目，并非上述项目的官方发行版。

## 两个重点

**GitHub 云备份，连未提交的代码也能留存。** 打开本地 Git 项目后，在「设置 → 云备份」通过浏览器连接 GitHub，预览将要备份的文件，再确认创建或选择自己名下的**私有**备份仓库。Dcode 读取已保存到磁盘的当前文件状态，包括已暂存、未暂存和未跟踪但未被 Git 忽略的文件，在独立 Git 仓库中生成快照；不会替你提交代码，也不会改动原项目的 `HEAD`、索引或远端。应用运行期间可按设定间隔检查变化，也可以手动立即备份；恢复时写入新目录，避免覆盖现有项目。[查看完整范围、排除规则和恢复步骤](docs/CLOUD-BACKUP.md)。

**ZCode 工作区与 DSH 执行链路相连。** DSH 负责模型、会话、消息流、工具调用和权限请求；Dcode 桌面界面负责项目选择、聊天展示以及原有文件、终端、Git/Diff 工作区。任务列表和聊天区共享 DSH 会话 ID，切换项目与重启后可恢复对应会话。[查看架构与当前边界](docs/DSH-INTEGRATION.md)。

**继续接通日常工作流。** 模型设置使用 ZCode 风格的供应商列表和模型详情，但由 DSH 保存供应商、模型和密钥；首次启动或在设置中可导入旧 ZCode 会话。会话草稿、忙碌时追加消息、文件与工具批注，以及可选的 Agent 插件入口均沿用 DSH 会话边界。[模型设置](docs/DSH-MODEL-PROVIDER-SETTINGS.md) · [会话导入](docs/DSH-ZCODE-SESSION-IMPORT.md) · [工作流衔接](docs/DSH-ZCODE-WORKFLOW-BRIDGE.md)。

> 本仓库是公开源码；云备份创建的是用户自己账号下的独立私有仓库。不要把私人项目或备份内容提交到本公开仓库。

## 当前支持范围

| 功能                                                      | 状态                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| Windows 桌面端的 DSH 聊天、工具执行、停止与继续、历史会话 | 已接入并通过本地模型夹具测试                                     |
| 文件编辑、终端、Git/Diff 与 DSH 任务联动                  | 已接入并通过打包版端到端测试                                     |
| GitHub 私有快照云备份与副本恢复                           | Windows 桌面端可用；需 Git for Windows 与 Git Credential Manager |
| GitHub Releases 自动检查与下载更新                        | Windows 安装版可用；下载后由用户确认重启安装                     |
| macOS/Linux 云备份                                        | 暂未支持                                                         |
| 旧 ZCode 的 MCP、技能、记忆、子智能体等设置驱动 DSH       | 尚未逐项贯通，不作为当前已支持功能宣传                           |

云备份只覆盖**已保存到磁盘**的文件，不包含编辑器里尚未保存的缓冲区；不复制原 Git 分支历史、LFS 内容或子模块。应用退出后不会继续定时备份。文件预览和常见凭证识别是辅助检查，上传前仍应自行确认私有仓库权限与文件清单。

## 从源码运行

需要 Git、[Node.js 24.14.0 与 pnpm 10.33.2](mise.toml)。在仓库根目录运行：

```powershell
pnpm install
pnpm bootstrap
pnpm dev:desktop
```

`bootstrap` 会准备依赖及桌面运行资源，首次执行可能需要下载额外组件。在 Windows 上执行 `pnpm build:desktop` 后，可用 `pnpm pack:dcode` 生成 NSIS 安装包、`latest.yml` 和 blockmap；用 `pnpm verify:dcode-release` 核对元数据与安装包。当前安装包未签名。

可在 [GitHub Releases 下载 v0.2.6 Windows x64 测试安装包](https://github.com/ningbainb/Dcode/releases/tag/v0.2.6)。v0.2.1 用户需先手动安装 v0.2.2 或更新版本；v0.2.2 及后续版本可在应用内检查更新。真实账号的在线链路尚待验收，使用前请阅读[发行说明与 SHA-256](docs/releases/v0.2.6.md)。macOS 和 Linux 的后续适配见[跨平台计划](docs/DCode-PLATFORM-PLAN.md)。

## 验证与贡献

```powershell
pnpm typecheck
pnpm lint
pnpm test:dcode
pnpm test:cloud-backup
```

DSH 运行时的本地夹具验收使用 `node packages/dsh-runtime/test/agent-e2e.mjs`，它不调用真实模型账号。新增功能请先阅读 [贡献指南](CONTRIBUTING.md) 和相关 `CONTRACT.md`，描述真实执行结果与未覆盖的平台。问题报告请勿附上凭证、私人项目或原始备份仓库内容；安全问题参见 [SECURITY.md](SECURITY.md)。

## 开源与来源

本仓库第一方改动遵循 [Apache-2.0](LICENSE)。保留了 ZCode 的原有声明与[原版 README](docs/upstream/ZCode-README.md)；移植的 DeepSeek Harness Desktop 生命周期代码遵循 BSD-3-Clause，具体来源、修订版本和许可证见 [vendor/PROVENANCE.md](packages/dsh-runtime/vendor/PROVENANCE.md) 与 [vendor/LICENSE](packages/dsh-runtime/vendor/LICENSE)。其他依赖和资源各自遵循原许可证，见 [NOTICE.DCode.md](NOTICE.DCode.md) 与 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。Dcode 图标源文件及桌面图标资源位于 [docs/assets](docs/assets) 和 [public/logo/icons](public/logo/icons)。

项目认可 [LINUX DO 社区](https://linux.do) 倡导的真诚、友善与专业交流。这个友链表达 Dcode 对社区的认可，不代表社区为本项目背书。
