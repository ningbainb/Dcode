import { useEffect, useState, type ComponentProps } from "react";
import { OccupationOnboarding } from "@/onboarding/OccupationOnboarding.js";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { ZcodeSessionImportSection } from "./ZcodeSessionImportSection.js";

const PROMPT_KEY = "dcode:zcode-import-prompt:v1";

/** DCode opens a local project without requiring a Z.AI account or occupation. */
export function DcodeOnboarding(props: ComponentProps<typeof OccupationOnboarding>) {
  const { dshService } = useServices();
  const { locale } = useZCodeIntl();
  const zh = locale.startsWith("zh");
  const [showImport, setShowImport] = useState(false);
  useEffect(() => {
    if (!dshService) return;
    try {
      if (localStorage.getItem(PROMPT_KEY)) return;
    } catch {
      return;
    }
    let active = true;
    void dshService
      .listZcodeImportCandidates()
      .then((items) => {
        if (active && items.some((item) => !item.imported)) setShowImport(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [dshService]);
  const dismiss = () => {
    setShowImport(false);
    try {
      localStorage.setItem(PROMPT_KEY, "seen");
    } catch {
      /* optional preference */
    }
  };
  if (!dshService) return <OccupationOnboarding {...props} />;
  return (
    <>
      {props.children}
      <Dialog
        open={showImport}
        onOpenChange={(open) => {
          if (!open) dismiss();
        }}
      >
        <DialogContent
          className="max-h-[85vh] max-w-2xl overflow-y-auto"
          data-testid="zcode-import-onboarding"
        >
          <DialogHeader>
            <DialogTitle>
              {zh ? "把 ZCode 会话带到 DCode" : "Bring ZCode conversations to DCode"}
            </DialogTitle>
            <DialogDescription>
              {zh
                ? "检测到本机的 ZCode 历史记录。挑选需要的会话导入；也可以稍后在设置中操作。"
                : "Local ZCode history was found. Choose conversations now, or import them later in Settings."}
            </DialogDescription>
          </DialogHeader>
          <ZcodeSessionImportSection onImported={dismiss} />
          <div className="flex justify-end">
            <Button variant="ghost" onClick={dismiss}>
              {zh ? "稍后再说" : "Maybe later"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
