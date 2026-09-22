import { useState } from "react";
import {
  Check,
  ChevronRight,
  FilePenLine,
  FileText,
  ListChecks,
  LoaderCircle,
  Search,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import type { DshRow } from "./projection.js";
import type { DshCopy } from "./dshCopy.js";

function parseArguments(input: string | undefined): Record<string, unknown> {
  if (!input) return {};
  try {
    const value: unknown = JSON.parse(input);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function argument(args: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    if (typeof args[name] === "string" && args[name]) return args[name];
  }
  return "";
}

function toolPresentation(row: DshRow, zh: boolean) {
  const name = (row.name ?? "tool").toLowerCase();
  const args = parseArguments(row.input);
  const path = argument(args, "file_path", "path", "target_path", "filename");
  if (name === "read") return { label: zh ? "读取文件" : "Read file", detail: path, icon: FileText };
  if (name === "write") return { label: zh ? "写入文件" : "Write file", detail: path, icon: FilePenLine };
  if (name === "edit") return { label: zh ? "编辑文件" : "Edit file", detail: path, icon: FilePenLine };
  if (name === "grep" || name === "search") return {
    label: zh ? "搜索代码" : "Search code",
    detail: argument(args, "pattern", "query", "search_pattern"), icon: Search,
  };
  if (name === "pwsh" || name === "bash" || name === "shell") return {
    label: zh ? "运行命令" : "Run command",
    detail: argument(args, "command", "cmd", "description"), icon: Terminal,
  };
  return { label: row.name ?? (zh ? "工具" : "Tool"), detail: path, icon: Wrench };
}

function formatInput(input: string | undefined): string {
  if (!input) return "";
  try { return JSON.stringify(JSON.parse(input), null, 2); } catch { return input; }
}

function ToolStep({ row, copy, zh }: { row: DshRow; copy: DshCopy; zh: boolean }) {
  const [open, setOpen] = useState(false);
  const presentation = toolPresentation(row, zh);
  const Icon = presentation.icon;
  const failed = row.state === "output-error";
  const running = row.state === "input-available";
  const status = failed ? copy.failed : running ? copy.running : copy.completed;
  const preview = (row.name === "pwsh" || row.name === "bash" || row.name === "shell")
    ? row.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1)
    : "";
  return (
    <div className="border-t border-border/50 first:border-t-0">
      <button
        type="button"
        data-testid="dsh-tool-row"
        data-tool-name={row.name}
        aria-expanded={open}
        aria-label={`${presentation.label} ${presentation.detail} ${status}`.trim()}
        onClick={() => setOpen(value => !value)}
        className="group flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-hover/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface text-foreground-subtle">
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui-sm">
            <span className="font-medium text-foreground">{presentation.label}</span>
            {presentation.detail && <span className="ml-2 text-foreground-subtle">{presentation.detail}</span>}
          </span>
          {preview && <span className="mt-0.5 block truncate font-mono text-ui-xs text-foreground-subtle">{preview}</span>}
        </span>
        <span className={`flex shrink-0 items-center gap-1 text-ui-xs ${failed ? "text-destructive" : "text-foreground-subtle"}`}>
          {failed ? <X className="size-3.5" /> : running ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {status}
        </span>
        <ChevronRight className={`size-3.5 shrink-0 text-foreground-subtle transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border/40 bg-background/40 px-4 py-3">
          {row.input && (
            <div>
              <div className="mb-1 text-ui-xs font-medium text-foreground-subtle">{copy.input}</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/70 p-2.5 font-mono text-ui-xs leading-relaxed text-foreground">{formatInput(row.input)}</pre>
            </div>
          )}
          {row.text && (
            <div>
              <div className="mb-1 text-ui-xs font-medium text-foreground-subtle">{copy.output}</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-background/70 p-2.5 font-mono text-ui-xs leading-relaxed text-foreground">{row.text}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function DshToolActivity({ rows, copy, zh }: { rows: DshRow[]; copy: DshCopy; zh: boolean }) {
  return (
    <section className="my-5 overflow-hidden rounded-xl border border-border/70 bg-surface/40" aria-label={copy.activity}>
      <div className="flex items-center gap-2 px-3 py-2 text-ui-xs text-foreground-subtle">
        <ListChecks className="size-3.5" />
        <span className="font-medium">{copy.activity}</span>
        <span className="ml-auto">{copy.activityCount(rows.length)}</span>
      </div>
      <div className="border-t border-border/50">
        {rows.map(row => <ToolStep key={row.id} row={row} copy={copy} zh={zh} />)}
      </div>
    </section>
  );
}
