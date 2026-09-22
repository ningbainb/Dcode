import { useState } from "react";
import { useServices } from "@/hooks/useServices.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { Button } from "@/components/ui/button.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import type { DshProviderConfig } from "@zcode/services";

export function DshSettings() {
  const { dshService } = useServices();
  const platform = usePlatform();
  const [config, setConfig] = useState<DshProviderConfig>({
    provider: "deepseek-official",
    api: "openai-completions",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKey: "",
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  async function restartRuntime() {
    if (!dshService) return;
    setDiagnosticBusy(true);
    setNotice("");
    try {
      await dshService.restart();
      window.dispatchEvent(new Event("dcode:dsh-runtime-restarted"));
      setNotice("Runtime restarted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setDiagnosticBusy(false);
    }
  }
  async function save() {
    if (!dshService) return;
    setBusy(true);
    setNotice("");
    try {
      await dshService.configureProvider(config);
      setConfig((old) => ({ ...old, apiKey: "" }));
      setNotice("Saved to DeepSeek Harness.");
      window.dispatchEvent(new Event("dcode:dsh-models-changed"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  const inputClass = "w-full rounded border bg-background p-2 text-ui-base";
  return (
    <div className="space-y-6" data-testid="dsh-model-settings">
      <p className="text-ui-base text-foreground-subtle">
        Model credentials are saved in DeepSeek Harness and used by Dcode chats.
      </p>
      <SettingsGroupCard>
        <SettingsRow
          label="DeepSeek Harness"
          description="Configure the provider used by Dcode."
          control={<span className="text-ui-xs text-foreground-subtle">Runtime</span>}
        />
      </SettingsGroupCard>
      <form
        className="grid max-w-xl gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p>Models and credentials are managed by DeepSeek Harness.</p>
        <label>
          Provider ID
          <input
            className={inputClass}
            value={config.provider}
            onChange={(event) => setConfig((old) => ({ ...old, provider: event.target.value }))}
          />
        </label>
        {config.provider !== "deepseek-official" && (
          <>
            <label>
              Protocol
              <select
                className={inputClass}
                value={config.api}
                onChange={(event) =>
                  setConfig((old) => ({
                    ...old,
                    api: event.target.value as DshProviderConfig["api"],
                  }))
                }
              >
                <option value="openai-completions">OpenAI compatible</option>
                <option value="anthropic-messages">Anthropic Messages</option>
              </select>
            </label>
            <label>
              Base URL
              <input
                className={inputClass}
                value={config.baseURL}
                onChange={(event) => setConfig((old) => ({ ...old, baseURL: event.target.value }))}
              />
            </label>
            <label>
              Model ID
              <input
                className={inputClass}
                value={config.model}
                onChange={(event) => setConfig((old) => ({ ...old, model: event.target.value }))}
              />
            </label>
          </>
        )}
        <label>
          API Key
          <input
            type="password"
            autoComplete="off"
            className={inputClass}
            value={config.apiKey}
            onChange={(event) => setConfig((old) => ({ ...old, apiKey: event.target.value }))}
          />
        </label>
        <Button disabled={busy || !config.apiKey} type="submit">
          {busy ? "Saving…" : "Save to DSH"}
        </Button>
        {notice && <p role="status">{notice}</p>}
      </form>
      <details className="rounded-lg border border-border/50 p-4 text-ui-base">
        <summary className="cursor-pointer font-medium">Runtime diagnostics</summary>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" disabled={diagnosticBusy} onClick={() => void restartRuntime()}>
            Restart Runtime
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void dshService
                ?.getLogsPath()
                .then((path) => platform.openExternalFile?.(path))
                .catch((error) => setNotice(error instanceof Error ? error.message : String(error)))
            }
          >
            Open Logs
          </Button>
        </div>
      </details>
    </div>
  );
}
