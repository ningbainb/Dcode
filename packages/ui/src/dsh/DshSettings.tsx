import { useState } from "react";
import { useServices } from "@/hooks/useServices.js";
import { Button } from "@/components/ui/button.js";
import type { DshProviderConfig } from "@zcode/services";

export function DshSettings({ onSaved }: { onSaved: () => void }) {
  const { dshService } = useServices();
  const [config, setConfig] = useState<DshProviderConfig>({ provider: "deepseek-official", api: "openai-completions", baseURL: "https://api.deepseek.com/v1", model: "deepseek-chat", apiKey: "" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function save() {
    if (!dshService) return;
    setBusy(true); setNotice("");
    try {
      await dshService.configureProvider(config);
      setConfig(old => ({ ...old, apiKey: "" }));
      setNotice("Saved to DeepSeek Harness."); onSaved();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const inputClass = "w-full rounded border bg-background p-2 text-ui-base";
  return <details className="border-b p-3 text-ui-base">
    <summary className="cursor-pointer font-medium">Agent Runtime Settings</summary>
    <form className="mt-3 grid max-w-xl gap-3" onSubmit={event => { event.preventDefault(); void save(); }}>
      <p>Models and credentials are managed by DeepSeek Harness.</p>
      <label>Provider ID<input className={inputClass} value={config.provider} onChange={event => setConfig(old => ({ ...old, provider: event.target.value }))} /></label>
      {config.provider !== "deepseek-official" && <>
        <label>Protocol<select className={inputClass} value={config.api} onChange={event => setConfig(old => ({ ...old, api: event.target.value as DshProviderConfig["api"] }))}><option value="openai-completions">OpenAI compatible</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
        <label>Base URL<input className={inputClass} value={config.baseURL} onChange={event => setConfig(old => ({ ...old, baseURL: event.target.value }))} /></label>
        <label>Model ID<input className={inputClass} value={config.model} onChange={event => setConfig(old => ({ ...old, model: event.target.value }))} /></label>
      </>}
      <label>API Key<input type="password" autoComplete="off" className={inputClass} value={config.apiKey} onChange={event => setConfig(old => ({ ...old, apiKey: event.target.value }))} /></label>
      <Button disabled={busy || !config.apiKey} type="submit">{busy ? "Saving…" : "Save to DSH"}</Button>
      {notice && <p role="status">{notice}</p>}
    </form>
  </details>;
}
