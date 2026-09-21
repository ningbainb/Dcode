import { useState } from "react";
import type { BackupProject } from "@zcode/services";
import type { useCloudBackup } from "@/hooks/useCloudBackup.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function CloudBackupSnapshots({
  project,
  workspacePath,
  busy,
  run,
}: {
  project: BackupProject;
  workspacePath: string;
  busy?: string;
  run: ReturnType<typeof useCloudBackup>["run"];
}) {
  const { intl, locale } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.cloudBackup.${key}` });
  const date = (value: string) => new Date(value).toLocaleString(locale);
  const platform = usePlatform();
  const [diff, setDiff] = useState<string>();
  const [restored, setRestored] = useState<string>();
  return (
    <>
      {" "}
      {project && (
        <div className="space-y-3">
          <h3 className="text-ui-base font-medium">{t("snapshots")}</h3>
          <SettingsGroupCard>
            {project.snapshots.length === 0 ? (
              <p className="p-4 text-ui-base text-foreground-subtle">{t("empty")}</p>
            ) : (
              [...project.snapshots]
                .reverse()
                .slice(0, 50)
                .map((snapshot) => (
                  <SettingsRow
                    key={snapshot.sha}
                    label={date(snapshot.createdAt)}
                    description={`${snapshot.sha.slice(0, 8)} · ${snapshot.files} ${t("files")} · ${snapshot.uploaded ? t("uploaded") : t("localOnly")}`}
                    control={
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void run("diff", async (service) =>
                              setDiff(await service.diff(workspacePath, snapshot.sha)),
                            )
                          }
                        >
                          Diff
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void run("restore", async (service) => {
                              const parent = await platform.selectDirectory();
                              if (parent)
                                setRestored(
                                  await service.restore(workspacePath, snapshot.sha, parent),
                                );
                            })
                          }
                        >
                          {t("restore")}
                        </Button>
                      </>
                    }
                  />
                ))
            )}
          </SettingsGroupCard>
          <p className="text-ui-sm text-foreground-subtle">{t("restoreHint")}</p>
        </div>
      )}
      {diff !== undefined && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="mb-2 flex justify-between text-ui-base">
            <span>{t("snapshotDiff")}</span>
            <Button variant="ghost" size="sm" onClick={() => setDiff(undefined)}>
              {t("close")}
            </Button>
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-ui-sm">{diff}</pre>
        </div>
      )}
      {restored && (
        <p role="status" className="break-all text-ui-base">
          {t("restored")} {restored}
        </p>
      )}
    </>
  );
}
