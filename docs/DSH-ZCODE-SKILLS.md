# ZCode skills in DSH sessions

## Behavior and ownership

Local Dcode sessions use DSH's native skill registry and `skill` tool. A Dcode profile bundle contributes ZCode skill files from the current Git worktree's `.zcode/skills` roots (nearest workspace directory first) and the current user's `~/.zcode/skills`. DSH's own `.dsh/skills` and `.agents/skills` provider remains active. This bridge never copies, moves, installs or rewrites a skill. ZCode's existing Skills page remains the writer for the ZCode roots and its `~/.zcode/cli/config.json` enable flags.

Enabled ZCode plugins also contribute their declared `skills` directories (or the plugin's default `skills` directory when no declaration exists). Discovery follows ZCode's installed-plugin records, inline plugin directories and official cache, including global enable, per-plugin enable and suppressed built-in settings. Plugin skills have lower precedence than workspace and user ZCode skills. The plugin manifest must use a relative skill path inside its own root; a broken manifest or installation is skipped independently. DSH loads only the Markdown skill content and local resources through its native skill tool. Other plugin components, such as commands, MCP servers, hooks and subagents, are not activated by this bridge.

The bridge reads only the accepted workspace's skill roots, the current user's ZCode root and enabled plugin skill roots. It follows ZCode's depth and excluded-directory scan policy, handles symlink cycles, and ignores unreadable or invalid Markdown entries individually. DSH requires a kebab-case invocation name and a nonempty description. Compatible names are kept; incompatible names get a stable kebab-case form (or a path-derived fallback), and the original name remains in the description. This is an adaptation, not an assertion that every ZCode-only skill extension is understood by DSH. ZCode's `disable-model-invocation` and `user-invocable` frontmatter flags are honored when present.

ZCode's disabled path map is read on every discovery and load. The provider watches the skill roots and enable-config file, invalidates DSH's catalog on changes, and reports a complete observation only after its watcher is ready. This matters because DSH intentionally withholds the model-facing catalog for incomplete observations. A skill disabled in the UI disappears from the next catalog after the filesystem change is observed, without restarting. The DSH registry remains the owner of skill precedence and model-facing presentation. The renderer does not inject a second skill prompt.

```text
ZCode Skills UI -> ~/.zcode/cli/config.json + .zcode/skills files
                                    |
                                    v
DSH profile bundle -> DSH skill provider -> DSH catalog / skill tool -> agent
```

## Acceptance

- A workspace `.zcode/skills/<name>/SKILL.md` and a user skill are visible in an actual DSH model request and can be loaded with the native `skill` tool.
- A disabled ZCode skill disappears from the next DSH catalog, while unrelated DSH skills remain available.
- Nested workspaces use the nearest ZCode root first; no new `.dsh` or `.agents` files are written into the user's project.
- A malformed or unreadable skill cannot prevent other skills or the DSH session from working.
- Enabling or disabling an installed plugin changes the next DSH skill catalog; an uninstalled or suppressed plugin is absent.
- Existing ZCode-only plugin components other than skills, plus memory, automation, hook and subagent settings, are not claimed as bridged by this skill provider.
