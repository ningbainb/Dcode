import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import type { DshAgentPluginStatus } from "@zcode/services";

type PluginId = "browser" | "windowsGui";

export function DshAgentPluginsSection({ isWindowsDesktop }: { isWindowsDesktop: boolean }) {
  const { dshService } = useServices();
  const { intl } = useZCodeIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const [status, setStatus] = useState<DshAgentPluginStatus | null>(null);
  const [pending, setPending] = useState<PluginId | "install" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void dshService
      ?.getAgentPlugins()
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      active = false;
    };
  }, [dshService]);

  async function toggle(id: PluginId, enabled: boolean) {
    if (!dshService) return;
    setPending(id);
    setError("");
    try {
      const next = await dshService.setAgentPluginEnabled(id, enabled);
      setStatus(next);
      window.dispatchEvent(new Event("dcode:dsh-runtime-restarted"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }

  async function installComputerUse() {
    if (!dshService) return;
    setPending("install");
    setError("");
    try {
      setStatus(await dshService.installWindowsGuiPlugin());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }

  const disabled = !dshService || !status || pending !== null;
  return (
    <div className="space-y-5" data-testid="dsh-agent-plugins">
      <p className="text-ui-base leading-6 text-foreground-subtle">
        {t("settings.dshPlugins.intro")}
      </p>
      <SettingsGroupCard>
        <SettingsRow
          label={t("settings.dshPlugins.browser.title")}
          description={t("settings.dshPlugins.browser.description")}
          control={
            <Switch
              aria-label={t("settings.dshPlugins.browser.title")}
              checked={status?.browser.enabled === true}
              disabled={disabled || (!status?.browser.available && !status?.browser.enabled)}
              onCheckedChange={(checked) => void toggle("browser", checked)}
            />
          }
          detail={
            <span className="text-ui-sm text-foreground-subtle">
              {t("settings.dshPlugins.browser.source")}
              {!isWindowsDesktop
                ? ` · ${t("settings.dshPlugins.windowsOnly")}`
                : status && !status.browser.available
                  ? ` · ${t("settings.dshPlugins.missing")}`
                  : ""}
            </span>
          }
        />
        {isWindowsDesktop ? (
          <SettingsRow
            label={t("settings.dshPlugins.computer.title")}
            description={t("settings.dshPlugins.computer.description")}
            control={
              <Switch
                aria-label={t("settings.dshPlugins.computer.title")}
                checked={status?.windowsGui.enabled === true}
                disabled={
                  disabled || (!status?.windowsGui.available && !status?.windowsGui.enabled)
                }
                onCheckedChange={(checked) => void toggle("windowsGui", checked)}
              />
            }
            detail={
              <div className="flex flex-wrap items-center gap-3 text-ui-sm text-foreground-subtle">
                <span>{t("settings.dshPlugins.computer.source")}</span>
                {status && !status.windowsGui.available ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={pending !== null}
                    onClick={() => void installComputerUse()}
                  >
                    {pending === "install"
                      ? t("settings.dshPlugins.installing")
                      : t("settings.dshPlugins.install")}
                  </Button>
                ) : null}
              </div>
            }
          />
        ) : null}
      </SettingsGroupCard>
      <p className="text-ui-sm leading-5 text-foreground-subtle">
        {t("settings.dshPlugins.restartHint")}
      </p>
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
