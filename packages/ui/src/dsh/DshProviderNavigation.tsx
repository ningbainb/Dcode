import { Plus } from "lucide-react";
import type { DshProviderSettings } from "@zcode/services";
import { Input } from "@/components/ui/input.js";
import { ProviderLogo } from "@/settings/model-provider-section/ProviderLogo.js";
import providerCatalog from "./provider-catalog.json" with { type: "json" };

const TEMPLATES = providerCatalog;

function logoKey(provider: DshProviderSettings): string {
  return provider.builtIn
    ? "deepseek"
    : (TEMPLATES.find((template) => template.id === provider.id)?.logo ?? "");
}

interface Labels {
  provider: string;
  native: string;
  configuredGroup: string;
  add: string;
  search: string;
  searchConfigured: string;
  noMatches: string;
  keyConfigured: string;
  keyMissing: string;
  newProvider: string;
}

interface Props {
  providers: DshProviderSettings[];
  selectedId: string | null;
  mode: "detail" | "catalog";
  draftName?: string;
  query: string;
  writable: boolean;
  labels: Labels;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
}

export function DshProviderNavigation({
  providers,
  selectedId,
  mode,
  draftName,
  query,
  writable,
  labels,
  onQueryChange,
  onSelect,
  onAdd,
}: Props) {
  const visibleProviders = providers.filter((provider) =>
    `${provider.name} ${provider.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const groups = [
    { id: "native", title: labels.native, items: visibleProviders.filter((item) => item.builtIn) },
    {
      id: "configured",
      title: labels.configuredGroup,
      items: visibleProviders.filter((item) => !item.builtIn),
    },
  ];

  return (
    <nav
      className="min-w-0 space-y-3 border-r border-border px-1.5 py-3 md:px-2 md:py-2"
      aria-label={labels.provider}
      data-model-provider-navigation-scroll="true"
    >
      {providers.length > 4 && (
        <Input
          aria-label={labels.searchConfigured}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={labels.search}
          className="mb-2 max-md:hidden"
        />
      )}
      {groups.map((group) =>
        group.items.length ? (
          <div key={group.id} className="space-y-1">
            <h3 className="flex h-7 items-center px-2 text-ui-sm font-semibold text-foreground-subtlest max-md:sr-only">
              {group.title}
            </h3>
            {group.items.map((provider) => {
              const selected = selectedId === provider.id && mode === "detail";
              return (
                <button
                  key={provider.id}
                  type="button"
                  data-testid="dsh-provider-nav-item"
                  title={provider.name}
                  aria-label={provider.name}
                  aria-selected={selected}
                  data-state={selected ? "selected" : "idle"}
                  onClick={() => onSelect(provider.id)}
                  className={`flex h-8 w-full items-center gap-2 rounded-lg border px-2 py-1 text-left text-ui-base font-medium transition-colors max-md:size-8 max-md:justify-center max-md:gap-0 max-md:px-0 ${
                    selected
                      ? "border-border-hover bg-card-selected text-foreground"
                      : "border-transparent text-foreground hover:border-border-hover/60 hover:bg-hover"
                  }`}
                >
                  <ProviderLogo
                    logo={{ type: "builtin", key: logoKey(provider) }}
                    className="size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate max-md:sr-only">{provider.name}</span>
                  <span
                    className={`size-1.5 shrink-0 rounded-full max-md:hidden ${provider.hasApiKey ? "bg-success" : "bg-foreground-subtlest"}`}
                    title={provider.hasApiKey ? labels.keyConfigured : labels.keyMissing}
                    aria-label={provider.hasApiKey ? labels.keyConfigured : labels.keyMissing}
                    data-key-state={provider.hasApiKey ? "configured" : "missing"}
                  />
                </button>
              );
            })}
          </div>
        ) : null,
      )}
      {providers.length > 0 && visibleProviders.length === 0 && (
        <p className="px-2 text-ui-caption text-foreground-subtle max-md:sr-only">
          {labels.noMatches}
        </p>
      )}
      {selectedId === "new" && mode === "detail" && (
        <div className="flex h-8 items-center gap-2 rounded-lg border border-border-hover bg-card-selected px-2 text-ui-base font-medium max-md:justify-center">
          <Plus className="size-4 shrink-0" />
          <span className="truncate max-md:sr-only">{draftName || labels.newProvider}</span>
        </div>
      )}
      <button
        type="button"
        data-testid="dsh-provider-nav-add"
        aria-selected={mode === "catalog"}
        disabled={!writable}
        onClick={onAdd}
        className={`flex h-8 w-full items-center gap-2 rounded-lg border px-2 py-1 text-left text-ui-base font-medium transition-colors max-md:size-8 max-md:justify-center max-md:gap-0 max-md:px-0 ${
          mode === "catalog"
            ? "border-border-hover bg-card-selected text-foreground"
            : "border-transparent text-foreground-subtle hover:border-border-hover/60 hover:bg-hover"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <Plus className="size-4 shrink-0" />
        <span className="max-md:sr-only">{labels.add}</span>
      </button>
    </nav>
  );
}
