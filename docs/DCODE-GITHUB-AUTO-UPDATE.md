# Dcode GitHub 自动升级

## 产品规则

- Dcode Windows 安装版在启动后和运行期间定时检查 `ningbainb/Dcode` 的公开 GitHub Releases。手动检查沿用现有“检查更新”入口。
- 仅安装版本高于当前 Dcode 版本的正式发行版；下载必须经过 `electron-updater` 对 `latest.yml` 中 SHA-512 的校验。下载完成后保留现有的显式安装确认和退出准备流程。
- ZIP 便携包不能承载 Windows NSIS 自动安装。正式发行产物应包括 NSIS 安装包、同一构建生成的 `latest.yml` 及校验文件；元数据须在安装包上传完成后再公开。
- GitHub 不可用、发行版缺少元数据或校验失败时展示现有错误状态，保留手动重试入口；不得回退到 ZCode 更新源或自动安装其他产品。
- 现有 v0.2.1 发行版没有 `latest.yml`，且已发布安装包关闭了更新器。因此自动升级从包含本功能的后续安装版开始生效，不能远程改造已安装的 v0.2.1。

## 所有权与事件顺序

`main/autoUpdater.ts` 是更新检查、下载、就绪和安装状态的唯一所有者。Electron Builder 的 Dcode 配置定义 GitHub 仓库及发行元数据；UI 只通过现有 IPC 展示状态和发出命令。
原先 Dcode 对上游服务的屏蔽不得阻止自己的更新弹窗；设置页保留自动下载选项，隐藏尚无发行流的预览选项。
原先清理 ZCode 菜单时的统一过滤不得删除 Dcode 的“检查更新”；主菜单和托盘均应可手动重试 GitHub 检查。

```text
启动 / 定时 / 手动检查
  → electron-updater GitHub provider 读取 latest.yml
  → 比较版本、下载并校验 NSIS 安装包
  → 现有 UpdateStateChanged / UpdateCheckResult IPC
  → 用户确认安装 → quitAndInstall
```

检查同一时刻只允许一个在途请求；手动检查不受自动轮询间隔限制。预览更新选项在 Dcode 尚无预览发行流时不改变正式版更新源。

## 验收

1. 打包配置生成 Dcode NSIS 安装器、`latest.yml`，其 GitHub owner/repo 与运行时 feed 一致。
2. 打包应用启动时访问 Dcode GitHub Release；仓库无更高版本时保持现有版本，不访问 ZCode 服务。
3. 缺少元数据、离线和校验失败只报告错误，不启动安装；手动检查能重试。
4. 更高版本下载后需要显式确认安装，并沿用窗口、Agent 退出准备。

2026-09-24 的隔离 Windows 实测已覆盖 v0.2.5 → v0.2.6 的 GitHub 版本发现、完整联网下载、`update-downloaded` 状态和落盘安装包 SHA-256 比对。显式安装后的退出、重启和版本迁移仍是独立验收项。
同日的 v0.2.6 → v0.2.7 隔离实测也通过同样四项检查，下载文件 SHA-256 为 `8723cf1749cf3b6e52fafaa3d0901b2c886ceb8cb68c801e7def725d30eb7d5a`。
