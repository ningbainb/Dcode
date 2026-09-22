import {
  DesktopCommandIds,
  TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER,
  TID_WORKSPACE_HELP_MENU_TRIGGER,
} from "@zcode/shared";
import { ActivityIcon, InfoIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { cn } from "@/components/lib/utils.js";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function WorkspaceHelpMenuButton({
  className,
  isDesktop = false,
}: {
  className?: string;
  isDesktop?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const platform = usePlatform();
  if (!isDesktop) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-md"
          className={cn("[app-region:no-drag]", className)}
          aria-label="Dcode"
          data-testid={TID_WORKSPACE_HELP_MENU_TRIGGER}
        >
          <InfoIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-testid={TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER}
          onSelect={() =>
            void platform.executeDesktopCommand(DesktopCommandIds.OpenResourceManager)
          }
        >
          <ActivityIcon className="size-4" />
          {intl.formatMessage({ id: "titleBar.menu.help.resourceManager" })}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void platform.executeDesktopCommand(DesktopCommandIds.ShowAbout)}
        >
          <InfoIcon className="size-4" />
          {intl.formatMessage({ id: "titleBar.menu.help.about" })}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
