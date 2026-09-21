import { CloudBackupPreview } from "./CloudBackupPreview.js";
import { CloudBackupSnapshots } from "./CloudBackupSnapshots.js";
import { useEffect, useState } from "react";
import { CloudUpload, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import type { BackupPreview } from "@zcode/services";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { Switch } from "@/components/ui/switch.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { SettingsBadge, SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { useCloudBackup } from "@/hooks/useCloudBackup.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function CloudBackupSection({ workspacePath }: { workspacePath?: string | null }) {
  const { intl, locale } = useZCodeIntl();
  const t = (key: string) => intl.formatMessage({ id: `settings.cloudBackup.${key}` });
  const platform = usePlatform();
  const { status, busy, error, run } = useCloudBackup(workspacePath);
  const [repository, setRepository] = useState(
    () =>
      `dcode-backup-${(workspacePath?.split(/[\\/]/).pop() || "project").replace(/[^a-zA-Z0-9_-]/g, "-")}`,
  );
  const [create, setCreate] = useState(true),
    [minutes, setMinutes] = useState("10");
  const [editing, setEditing] = useState(false);
  const [excludes, setExcludes] = useState(""),
    [preview, setPreview] = useState<BackupPreview>();
  const [repositories, setRepositories] = useState<string[]>([]);
  const project = status?.project;
  useEffect(() => {
    if (project) {
      setRepository(project.repository);
      setCreate(false);
      setMinutes(String(project.intervalMinutes));
      setExcludes(project.excludes.join("\n"));
    }
  }, [project?.path]);
  const rules = excludes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const target = create ? `${status?.account}/${repository}` : repository;
  const date = (value?: string) => (value ? new Date(value).toLocaleString(locale) : t("never"));
  if (!status)
    return (
      <p className="text-ui-base text-foreground-subtle" role="status">
        {error || t("loading")}
      </p>
    );
  if (!status.supported)
    return <p className="text-ui-base text-foreground-subtle">{t("unsupported")}</p>;
  return (
    <div className="space-y-6" data-testid="cloud-backup-settings">
      <p className="text-ui-base text-foreground-subtle">{t("description")}</p>
      {(error || status.error || project?.lastError) && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-card p-3 text-ui-base text-destructive"
        >
          {error || status.error || project?.lastError}
        </div>
      )}
      <SettingsGroupCard>
        <SettingsRow
          label={t("account")}
          description={status.account ? `GitHub · ${status.account}` : t("accountHint")}
          control={
            status.account ? (
              <Button
                variant="outline"
                size="lg"
                disabled={Boolean(busy)}
                onClick={() => void run("disconnect", (service) => service.disconnect())}
              >
                {t("disconnect")}
              </Button>
            ) : busy === "login" || status.loginPending ? (
              <Button
                variant="outline"
                size="lg"
                onClick={() => void run("cancel", (service) => service.cancelLogin())}
              >
                {t("cancelLogin")}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="lg"
                disabled={Boolean(busy)}
                onClick={() => void run("login", (service) => service.login())}
              >
                <ExternalLink className="size-4" />
                {t("login")}
              </Button>
            )
          }
        />
      </SettingsGroupCard>
      {!workspacePath ? (
        <p className="text-ui-base text-foreground-subtle">{t("openProject")}</p>
      ) : (
        <>
          <SettingsGroupCard>
            <SettingsRow
              label={t("automatic")}
              description={project ? t("pauseHint") : t("firstHint")}
              control={
                <Switch
                  aria-label={t("automatic")}
                  checked={project?.enabled ?? false}
                  disabled={Boolean(busy) || !status.account}
                  onCheckedChange={(enabled) => {
                    if (project?.approved)
                      void run("toggle", (service) => service.setEnabled(workspacePath, enabled));
                    else {
                      setEditing(true);
                      document
                        .getElementById("cloud-backup-setup")
                        ?.scrollIntoView({ behavior: "smooth" });
                    }
                  }}
                />
              }
            />
            <SettingsRow
              label={t("project")}
              description={<span className="break-all">{workspacePath}</span>}
              control={
                <SettingsBadge>{project?.enabled ? t("enabled") : t("disabled")}</SettingsBadge>
              }
            />
            {project && (
              <>
                <SettingsRow
                  label={t("destination")}
                  description={project.repository}
                  control={
                    <Button
                      variant="ghost"
                      size="lg"
                      onClick={() =>
                        platform.openExternal(`https://github.com/${project.repository}`)
                      }
                    >
                      <ExternalLink className="size-4" />
                      GitHub
                    </Button>
                  }
                />
                <SettingsRow
                  label={t("cloudTime")}
                  description={date(project.lastCloud)}
                  control={
                    <Button
                      variant="outline"
                      size="lg"
                      disabled={Boolean(busy) || !project.enabled}
                      onClick={() => void run("backup", (service) => service.backup(workspacePath))}
                    >
                      <CloudUpload className="size-4" />
                      {t("backupNow")}
                    </Button>
                  }
                />
                <SettingsRow
                  label={t("localTime")}
                  description={date(project.lastLocal)}
                  control={
                    <SettingsBadge>
                      {project.snapshots.filter((item) => !item.uploaded).length} {t("pending")}
                    </SettingsBadge>
                  }
                />
                <SettingsRow
                  label={t("frequency")}
                  description={`${project.intervalMinutes} ${t("minutes")}`}
                  control={
                    <Button
                      variant="ghost"
                      size="lg"
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setEditing(!editing);
                        setPreview(undefined);
                      }}
                    >
                      {editing ? t("close") : t("edit")}
                    </Button>
                  }
                />
              </>
            )}
          </SettingsGroupCard>
          {(!project || editing) && (
            <div id="cloud-backup-setup" className="space-y-3">
              <h3 className="text-ui-base font-medium text-foreground">{t("setup")}</h3>
              <SettingsGroupCard>
                <SettingsRow
                  label={t("destination")}
                  description={t("privateHint")}
                  control={
                    <Select
                      value={create ? "new" : "existing"}
                      onValueChange={(value) => {
                        setCreate(value === "new");
                        setRepository("");
                        setPreview(undefined);
                      }}
                      disabled={Boolean(busy) || Boolean(project)}
                    >
                      <SelectTrigger size="lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">{t("newRepo")}</SelectItem>
                        <SelectItem value="existing">{t("existingRepo")}</SelectItem>
                      </SelectContent>
                    </Select>
                  }
                  detail={
                    <div className="space-y-2">
                      <Input
                        size="lg"
                        aria-label={t("repoName")}
                        value={repository}
                        placeholder={create ? "dcode-backup-project" : "owner/repository"}
                        onChange={(event) => {
                          setRepository(event.target.value);
                          setPreview(undefined);
                        }}
                        disabled={Boolean(busy) || Boolean(project)}
                      />
                      {!create && !project && (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={Boolean(busy) || !status.account}
                            onClick={() =>
                              void run("repositories", async (service) =>
                                setRepositories(await service.repositories()),
                              )
                            }
                          >
                            <RefreshCw className="size-3" />
                            {t("loadRepos")}
                          </Button>
                          {repositories.map((repo) => (
                            <Button
                              key={repo}
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRepository(repo);
                                setPreview(undefined);
                              }}
                            >
                              {repo}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  }
                />
                <SettingsRow
                  label={t("frequency")}
                  description={t("frequencyHint")}
                  control={
                    <Select value={minutes} onValueChange={setMinutes} disabled={Boolean(busy)}>
                      <SelectTrigger size="lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[5, 10, 30, 60].map((value) => (
                          <SelectItem key={value} value={String(value)}>
                            {value} {t("minutes")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                />
                <SettingsRow
                  label={t("excludes")}
                  description={t("excludesHint")}
                  control={<SettingsBadge>.gitignore</SettingsBadge>}
                  detail={
                    <Textarea
                      aria-label={t("excludes")}
                      value={excludes}
                      placeholder={"coverage/\n*.log"}
                      disabled={Boolean(busy)}
                      onChange={(event) => {
                        setExcludes(event.target.value);
                        setPreview(undefined);
                      }}
                    />
                  }
                />
              </SettingsGroupCard>
              <Button
                variant="outline"
                size="lg"
                disabled={Boolean(busy) || !status.account || !repository}
                onClick={() =>
                  void run("preview", async (service) =>
                    setPreview(await service.preview(workspacePath, rules)),
                  )
                }
              >
                {t("preview")}
              </Button>
              {!create && !project && (
                <Button
                  variant="ghost"
                  size="lg"
                  disabled={Boolean(busy) || !status.account || !repository}
                  onClick={() =>
                    void run("import", (service) => service.importRemote(workspacePath, repository))
                  }
                >
                  {t("readCloud")}
                </Button>
              )}
              {preview && (
                <CloudBackupPreview preview={preview} target={target}>
                  <Button
                    size="lg"
                    disabled={Boolean(busy) || preview.blocked.length > 0}
                    onClick={() =>
                      void run("enable", async (service) => {
                        await service.enable({
                          path: workspacePath,
                          repository: target,
                          create,
                          intervalMinutes: Number(minutes),
                          excludes: rules,
                          fingerprint: preview.fingerprint,
                        });
                        setEditing(false);
                      })
                    }
                  >
                    {project ? t("saveAndBackup") : t("confirm")}
                  </Button>
                </CloudBackupPreview>
              )}
            </div>
          )}
          {project && (
            <CloudBackupSnapshots
              project={project}
              workspacePath={workspacePath}
              busy={busy}
              run={run}
            />
          )}
        </>
      )}
      {busy && (
        <div role="status" className="flex items-center gap-2 text-ui-base text-foreground-subtle">
          <LoaderCircle className="size-4 animate-spin" />
          {busy === "login" ? t("browserWaiting") : t("working")}
        </div>
      )}
      <p className="text-ui-sm text-foreground-subtlest">{t("scope")}</p>
    </div>
  );
}
