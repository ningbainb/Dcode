# DSH subagent settings in Dcode

## Behavior and ownership

DSH owns subagent execution, lineage, permissions, and the host `subagent.maxDepth` setting. Dcode Settings reads the resolved namespace with `settings/describe` and writes only `maxDepth` through `settings/update` with the expected revision. The value is a non-negative integer; `0` blocks tool-mediated delegation, `1` permits direct children, and larger values permit nested children up to that absolute depth. A change applies to the next delegation attempt, not by rewriting an existing child. The Dcode UI displays the resolved value and read-only state after every successful write. A stale revision is rejected and the user must refresh rather than overwriting another editor.

The local Desktop Subagents section uses the existing ZCode settings layout. It shows DSH's delegation depth, not the legacy ZCode profile editor. ZCode `.zcode/agents` files, per-agent model/tool overrides, and plugin agent definitions are not imported by this setting and must not be represented as active DSH agents. Non-DSH workspaces retain their existing ZCode Subagents page.
The connected DSH page must not show the generic legacy warning that says its settings do not affect chat execution.

```text
Settings UI -> IDshService -> DshBackend -> DSH settings/describe + settings/update
                                                |
                                                v
                                      DSH subagent tool's next call
```

## Acceptance

- Local DSH Settings displays the Subagents entry and the current DSH max depth.
- Setting depth `0` is persisted to the DSH profile and prevents a new tool-mediated delegation; changing it to `1` enables a direct child again.
- A stale revision and a read-only profile produce an error without claiming success.
- Restarting the runtime preserves the chosen depth.
