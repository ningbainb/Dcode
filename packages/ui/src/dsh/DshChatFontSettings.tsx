import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";

export function DshChatFontSettings() {
  const { locale } = useZCodeIntl();
  const zh = locale.startsWith("zh");
  const { settings, update } = useSettings();
  const [error, setError] = useState("");
  const fontSize = settings?.dcodeChatFontSize ?? null;
  const fontFamily = settings?.dcodeChatFontFamily ?? "default";
  const save = (patch: Parameters<typeof update>[0]) => {
    setError("");
    void update(patch).catch((failure: unknown) =>
      setError(failure instanceof Error ? failure.message : String(failure)),
    );
  };

  return (
    <section className="min-w-0 space-y-3" data-testid="dsh-chat-font-settings">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-ui-lg font-semibold text-foreground">
            {zh ? "会话阅读" : "Conversation reading"}
          </h3>
          <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
            {zh
              ? "调整会话消息正文，不影响编辑器、终端、输入框或界面缩放。"
              : "Adjust message text without changing the editor, terminal, composer, or interface scale."}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={fontSize === null && fontFamily === "default"}
          onClick={() => save({ dcodeChatFontSize: null, dcodeChatFontFamily: "default" })}
        >
          {zh ? "恢复默认" : "Reset"}
        </Button>
      </div>
      <SettingsGroupCard>
        <SettingsRow
          label={zh ? "消息字号" : "Message font size"}
          description={
            zh ? "适用于用户与 Agent 的消息正文。" : "Applies to user and agent message text."
          }
          control={
            <Select
              value={fontSize === null ? "default" : String(fontSize)}
              onValueChange={(value) =>
                save({ dcodeChatFontSize: value === "default" ? null : Number(value) })
              }
            >
              <SelectTrigger
                size="lg"
                className="w-48 justify-between"
                aria-label={zh ? "消息字号" : "Message font size"}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{zh ? "跟随默认" : "Use default"}</SelectItem>
                {[12, 13, 14, 15, 16, 17, 18].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size} px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          label={zh ? "消息字体" : "Message font"}
          description={zh ? "选择消息正文的字体类型。" : "Choose the typeface for message text."}
          control={
            <Select
              value={fontFamily}
              onValueChange={(value) =>
                save({ dcodeChatFontFamily: value as "default" | "system" | "mono" })
              }
            >
              <SelectTrigger
                size="lg"
                className="w-48 justify-between"
                aria-label={zh ? "消息字体" : "Message font"}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{zh ? "DCode 默认" : "DCode default"}</SelectItem>
                <SelectItem value="system">{zh ? "系统字体" : "System"}</SelectItem>
                <SelectItem value="mono">{zh ? "等宽字体" : "Monospace"}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </SettingsGroupCard>
      {error && (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
