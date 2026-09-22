import { useEffect, useState } from "react";
import type { DshZcodeImportCandidate, DshZcodeImportResult } from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card.js";
import { Loader2, RefreshCcw } from "lucide-react";

export function ZcodeSessionImportSection({ onImported }: { onImported?: () => void }) {
  const { dshService } = useServices();
  const { locale } = useZCodeIntl();
  const zh = locale.startsWith("zh");
  const [candidates, setCandidates] = useState<DshZcodeImportCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<"scan" | "import" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DshZcodeImportResult[] | null>(null);

  async function scan() {
    if (!dshService) return;
    setBusy("scan");
    setError("");
    try {
      const rows = await dshService.listZcodeImportCandidates();
      setCandidates(rows);
      setSelected((old) =>
        old.filter((id) => rows.some((row) => row.sourceId === id && !row.imported)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void scan();
  }, [dshService]);

  async function importSelected() {
    if (!dshService || selected.length === 0) return;
    setBusy("import");
    setError("");
    try {
      const outcome = await dshService.importZcodeSessions(selected);
      setResult(outcome);
      if (outcome.some((entry) => entry.status === "imported")) {
        window.dispatchEvent(new Event("dcode:zcode-sessions-imported"));
        if (outcome.every((entry) => entry.status !== "failed")) onImported?.();
      }
      setSelected([]);
      setCandidates(await dshService.listZcodeImportCandidates());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="zcode-session-import">
      <p className="text-ui-base leading-6 text-foreground-subtle">
        {zh
          ? "选择本机 ZCode 的历史会话，复制到 DCode 中阅读。原始记录不会修改；导入不会上传到云端。"
          : "Copy selected local ZCode conversations into DCode for reading. The originals stay untouched and import does not upload them."}
      </p>
      <Card className="border border-border bg-card py-0 shadow-none">
        <CardHeader className="border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>{zh ? "发现的会话" : "Found conversations"}</CardTitle>
              <CardDescription>
                {zh ? "按最近使用时间排序，最多显示 500 条" : "Most recent first, up to 500"}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null || !dshService}
              onClick={() => void scan()}
            >
              {busy === "scan" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCcw className="size-3.5" />
              )}
              {zh ? "重新扫描" : "Rescan"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-4 py-4">
          {error && (
            <p role="alert" className="text-ui-sm text-destructive">
              {error}
            </p>
          )}
          {!busy && candidates.length === 0 && (
            <p className="text-ui-sm text-foreground-subtle">
              {zh ? "未找到可导入的 ZCode 会话。" : "No ZCode conversations were found."}
            </p>
          )}
          {candidates.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-2 text-ui-xs text-foreground-subtle">
                <span>{zh ? `已选择 ${selected.length} 条` : `${selected.length} selected`}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    setSelected(
                      candidates.filter((item) => !item.imported).map((item) => item.sourceId),
                    )
                  }
                >
                  {zh ? "选择全部未导入" : "Select all new"}
                </Button>
              </div>
              <div className="max-h-96 space-y-1 overflow-y-auto">
                {candidates.map((item) => (
                  <label
                    key={item.sourceId}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/70 bg-surface/40 px-3 py-2.5 hover:bg-surface-hover"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 accent-brand"
                      disabled={item.imported || busy !== null}
                      checked={item.imported || selected.includes(item.sourceId)}
                      onChange={(event) =>
                        setSelected((old) =>
                          event.target.checked
                            ? [...old, item.sourceId]
                            : old.filter((id) => id !== item.sourceId),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ui-sm font-medium text-foreground">
                        {item.title}
                      </span>
                      <span
                        className="block truncate text-ui-xs text-foreground-subtle"
                        title={item.workspacePath}
                      >
                        {item.workspacePath}
                      </span>
                      <span className="text-ui-xs text-foreground-subtle">
                        {new Date(item.updatedAt).toLocaleString(locale)} · {item.messageCount}{" "}
                        {zh ? "条消息" : "messages"}
                      </span>
                    </span>
                    {item.imported && (
                      <span className="shrink-0 text-ui-xs text-foreground-subtle">
                        {zh ? "已导入" : "Imported"}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </>
          )}
          {result && (
            <p role="status" className="text-ui-sm text-foreground-subtle">
              {zh
                ? `导入 ${result.filter((x) => x.status === "imported").length} 条，跳过 ${result.filter((x) => x.status === "skipped").length} 条，失败 ${result.filter((x) => x.status === "failed").length} 条。`
                : `Imported ${result.filter((x) => x.status === "imported").length}, skipped ${result.filter((x) => x.status === "skipped").length}, failed ${result.filter((x) => x.status === "failed").length}.`}
              {result
                .filter((x) => x.status === "failed")
                .map((x) => (
                  <span key={x.sourceId} className="block text-destructive">
                    {x.error}
                  </span>
                ))}
            </p>
          )}
          <Button
            disabled={busy !== null || selected.length === 0}
            onClick={() => void importSelected()}
          >
            {busy === "import" && <Loader2 className="size-3.5 animate-spin" />}
            {zh ? "导入所选会话" : "Import selected"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
