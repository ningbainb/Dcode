import { useCallback, useEffect, useState } from "react";
import type { DshSubagentSettingsView } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

const COPY = {
  zh: {
    intro: "Dcode 的子智能体由 DSH 执行。这里设置委派深度，保存后对下一次委派生效。",
    depth: "最大委派层级",
    depthDescription: "0 关闭子智能体委派；1 允许直接子智能体；更高层级允许子智能体继续委派。",
    off: "关闭",
    direct: "1 层（直接子智能体）",
    levels: (count: number) => `${count} 层`,
    refresh: "刷新",
    loading: "正在读取 DSH 子智能体设置…",
    readOnly: "当前 DSH 配置为只读。",
    legacy: "旧 ZCode 自定义智能体配置尚未迁入 DSH；此处只控制 DSH 原生子智能体。",
  },
  en: {
    intro: "DSH runs Dcode subagents. Delegation depth changes apply to the next delegation.",
    depth: "Maximum delegation depth",
    depthDescription:
      "0 disables delegation; 1 allows direct children; higher values permit nested children.",
    off: "Off",
    direct: "1 level (direct children)",
    levels: (count: number) => `${count} levels`,
    refresh: "Refresh",
    loading: "Loading DSH subagent settings…",
    readOnly: "DSH settings are read-only.",
    legacy:
      "Legacy ZCode agent profiles are not imported into DSH yet. This controls native DSH subagents only.",
  },
};

export function DshSubagentsSection() {
  const { dshService } = useServices();
  const { locale } = useZCodeIntl();
  const t = locale.startsWith("zh") ? COPY.zh : COPY.en;
  const [view, setView] = useState<DshSubagentSettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!dshService) return;
    setBusy(true);
    setError("");
    try {
      setView(await dshService.listSubagentSettings());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [dshService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function update(maxDepth: number) {
    if (!dshService || !view) return;
    setBusy(true);
    setError("");
    try {
      setView(await dshService.updateSubagentSettings(maxDepth, view.revision));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const choices = [...new Set([0, 1, 2, 3, 4, view?.maxDepth ?? 1])].sort((a, b) => a - b);
  return (
    <div className="space-y-5" data-testid="dsh-subagent-settings">
      <p className="text-ui-base leading-6 text-foreground-subtle">{t.intro}</p>
      <SettingsGroupCard>
        <SettingsRow
          label={t.depth}
          description={t.depthDescription}
          control={
            <Select
              value={view ? String(view.maxDepth) : undefined}
              disabled={busy || !view?.writable}
              onValueChange={(value) => void update(Number(value))}
            >
              <SelectTrigger aria-label={t.depth} size="lg" className="w-56 justify-between">
                <SelectValue placeholder={t.loading} />
              </SelectTrigger>
              <SelectContent>
                {choices.map((depth) => (
                  <SelectItem key={depth} value={String(depth)}>
                    {depth === 0 ? t.off : depth === 1 ? t.direct : t.levels(depth)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsGroupCard>
      <div className="flex items-center justify-between gap-4">
        <p className="text-ui-sm leading-5 text-foreground-subtle">
          {!view?.writable && view ? t.readOnly : t.legacy}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void refresh()}
        >
          {t.refresh}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
