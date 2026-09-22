import type { ReactNode } from "react";
import logoUrl from "@/assets/dcode-logo.png";
import { cn } from "@/components/lib/utils.js";

interface RootStartupLoadingProps {
  label: string;
  children?: ReactNode;
  busy?: boolean;
}
export function RootStartupLoading({ label, children, busy = true }: RootStartupLoadingProps) {
  return (
    <div
      className="flex h-full min-h-dvh flex-col items-center justify-center gap-6 bg-background text-foreground"
      role="status"
      aria-busy={busy}
      aria-label={label}
      data-testid="root-startup-loading"
    >
      <ZCodeStartupLogoBadge />
      {children}
    </div>
  );
}
/** 初始化和引导共享同一份 Dcode 原图，避免内嵌 SVG 遗留旧标识。 */
export function ZCodeStartupLogoBadge({ animated = true }: { animated?: boolean }) {
  return (
    <img
      src={logoUrl}
      alt="Dcode"
      className={cn("size-24 object-contain", animated && "motion-safe:animate-pulse")}
    />
  );
}
