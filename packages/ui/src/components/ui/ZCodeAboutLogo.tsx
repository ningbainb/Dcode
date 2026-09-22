import { cn } from "@/components/lib/utils.js";
import logoUrl from "@/assets/dcode-logo.png";

export function ZCodeAboutLogo({ className }: { className?: string }) {
  return <img src={logoUrl} alt="Dcode" className={cn("shrink-0", className)} />;
}

export function ZCodeWordmarkLogo({ className }: { className?: string }) {
  return <img src={logoUrl} alt="Dcode" className={cn("shrink-0", className)} />;
}
