import type { ReactNode } from "react";
import type { BackupPreview } from "@zcode/services";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function CloudBackupPreview({
  preview,
  target,
  children,
}: {
  preview: BackupPreview;
  target: string;
  children: ReactNode;
}) {
  const { intl } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.cloudBackup.${key}` });
  return (
    <div
      className="space-y-3 rounded-xl border border-border bg-card p-4 text-ui-base"
      data-testid="cloud-backup-preview"
    >
      <p className="font-medium">
        {target} · {t("private")}
      </p>
      <p>
        {preview.files.length} {t("files")} · {(preview.bytes / 1024).toFixed(1)} KiB ·{" "}
        {preview.excluded.length} {t("excluded")}
      </p>
      <p className="text-foreground-subtle">{t("savedOnly")}</p>
      <details>
        <summary className="cursor-pointer">{t("fileList")}</summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-ui-sm">
          {preview.files.join("\n") || t("empty")}
        </pre>
      </details>
      <details>
        <summary className="cursor-pointer">{t("excluded")}</summary>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-ui-sm">
          {preview.excluded.map((item) => item.path).join("\n") || t("empty")}
        </pre>
      </details>
      {preview.blocked.length > 0 && (
        <div role="alert" className="text-destructive">
          {t("blocked")}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-ui-sm">
            {preview.blocked.map((item) => `${item.path}: ${item.reason}`).join("\n")}
          </pre>
        </div>
      )}
      {children}
    </div>
  );
}
