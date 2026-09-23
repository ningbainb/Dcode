# ZCode 全局指令接入 DSH

Dcode 将当前用户 `~/.zcode/AGENTS.md` 的内容同步到自己的私有 `$DSH_HOME/AGENTS.md`，由 DSH 原生 `agent-instructions` 插件加载。工作区内的 `AGENTS.md`、`CLAUDE.md` 仍按 DSH 自身的作用域和优先级处理。Dcode 不修改 ZCode 源文件，也不写入用户独立安装的 DSH Home。

同步在 Dcode Profile 启动时及每次聊天提示提交前执行。私有 DSH 文件中已有的非 Dcode 内容会保留；Dcode 只替换带标记的片段。源文件修改或删除后，下一条提示使 DSH 原生插件发出更新或移除通知，已有会话无需重新导入。同步失败会阻止该提示提交，避免用户误以为新指令已经生效。

隔离测试 `packages/dsh-runtime/test/zcode-instructions-e2e.mjs` 使用真实 DSH 0.1.7 运行时和本地合成模型，验证首次加载、同一会话内更新与移除都到达模型请求；它不验证第三方在线模型的行为。工作区级 ZCode 指令若已采用标准 `AGENTS.md` 或 `CLAUDE.md`，由 DSH 原生插件直接发现，不需要另一次复制。
