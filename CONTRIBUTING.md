# 参与贡献

欢迎提交问题报告、文档修订和代码改进。Dcode 当前优先维护 Windows 桌面的 DSH 核心链路与 GitHub 私有快照备份；其他平台或旧 ZCode 功能的行为请先说明可复现环境，不要假定它们已接入 DSH。

1. 阅读根目录 [AGENTS.md](AGENTS.md) 与目标模块的 `CONTRACT.md`；行为变更先写清规则、状态所有者和验收场景。
2. 使用 [mise.toml](mise.toml) 固定的 Node.js 24.14.0、pnpm 10.33.2。运行 `pnpm install`、`pnpm bootstrap` 后在独立项目里开发。
3. 提交前运行 `pnpm typecheck`、`pnpm lint`；改动 DSH 或备份时分别运行 `pnpm test:dcode`、`pnpm test:cloud-backup`。交互变化请附实际界面截图或端到端验证记录。
4. Pull Request 说明具体触发条件、改动前后行为、验证结果和未验证的平台或在线账号。请保留上游来源、许可证及第三方声明。

不要在 Issue、PR、截图或测试夹具中提交令牌、真实账号数据、私人项目内容、备份快照或含凭证的日志。安全问题按 [SECURITY.md](SECURITY.md) 处理。
