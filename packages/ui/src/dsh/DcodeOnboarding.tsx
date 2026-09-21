import type { ComponentProps } from "react";
import { OccupationOnboarding } from "@/onboarding/OccupationOnboarding.js";
import { useServices } from "@/hooks/useServices.js";

/** DCode opens a local project without requiring a Z.AI account or occupation. */
export function DcodeOnboarding(props: ComponentProps<typeof OccupationOnboarding>) {
  const { dshService } = useServices();
  return dshService ? <>{props.children}</> : <OccupationOnboarding {...props} />;
}
