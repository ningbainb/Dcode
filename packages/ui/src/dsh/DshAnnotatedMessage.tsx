/* eslint-disable max-lines -- Selection range, highlight and its lightweight editor share one DOM owner. */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MessageAction,
  MessageActions,
  MessageResponse,
} from "@/components/ai-elements/message.js";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { Check, Copy } from "lucide-react";
import type { DshSessionAnnotation } from "@zcode/services";
import type { DshRow } from "./projection.js";

const highlightRanges = new Map<string, Range[]>();
const highlightName = "dcode-session-annotation";
const highlightStyleId = "dcode-session-annotation-style";

function updateHighlights() {
  if (!("highlights" in CSS) || !("Highlight" in window)) return;
  if (!document.getElementById(highlightStyleId)) {
    const style = document.createElement("style");
    style.id = highlightStyleId;
    style.textContent = `::highlight(${highlightName}) { background-color: var(--color-accent); text-decoration: underline; text-decoration-color: var(--color-brand); text-underline-offset: 0.16em; }`;
    document.head.append(style);
  }
  const ranges = [...highlightRanges.values()].flat();
  CSS.highlights.delete(highlightName);
  if (ranges.length) CSS.highlights.set(highlightName, new Highlight(...ranges));
}

function rangeAt(root: HTMLElement, start: number, length: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startInNode = 0;
  let endInNode = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const next = cursor + node.length;
    if (!startNode && start >= cursor && start < next) {
      startNode = node;
      startInNode = start - cursor;
    }
    if (startNode && start + length <= next) {
      endNode = node;
      endInNode = start + length - cursor;
      break;
    }
    cursor = next;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startInNode);
  range.setEnd(endNode, endInNode);
  return range;
}

function annotationRange(root: HTMLElement, item: DshSessionAnnotation): Range | null {
  const exact = rangeAt(root, item.startOffset, item.selectedText.length);
  if (exact?.toString() === item.selectedText) return exact;
  // Markdown can add non-message controls to the DOM. Keep the quote anchored
  // to the same immutable source message and choose the nearest exact match.
  const rendered = root.textContent ?? "";
  let position = rendered.indexOf(item.selectedText);
  let best: Range | null = null;
  let distance = Infinity;
  while (position >= 0) {
    const range = rangeAt(root, position, item.selectedText.length);
    const gap = Math.abs(position - item.startOffset);
    if (range?.toString() === item.selectedText && gap < distance) {
      best = range;
      distance = gap;
    }
    position = rendered.indexOf(item.selectedText, position + 1);
  }
  return best;
}

type SelectionDraft = { selectedText: string; startOffset: number; top: number; left: number };

export function DshAnnotatedMessage({
  row,
  sessionId,
  workspacePath,
  annotations,
  zh,
  onCreate,
  onUpdate,
  onDelete,
  onAsk,
}: {
  row: DshRow;
  sessionId: string;
  workspacePath: string;
  annotations: DshSessionAnnotation[];
  zh: boolean;
  onCreate: (input: {
    messageId: string;
    role: "user" | "assistant";
    sourceText: string;
    selectedText: string;
    startOffset: number;
    comment: string;
  }) => Promise<void>;
  onUpdate: (
    id: string,
    patch: { comment?: string; status?: "pending" | "sent" | "resolved" },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAsk: (quote: string, annotationId?: string) => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SelectionDraft | null>(null);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [validIds, setValidIds] = useState<Set<string>>(new Set());
  const stable = row.id.startsWith("event:") && (row.kind === "user" || row.kind === "assistant");
  const key = `${sessionId}:${row.id}`;
  const active = annotations.find((item) => item.id === openId);

  useEffect(() => {
    // React 可复用相同 event ID 的组件；切会话时必须清掉上一会话的选区和编辑器。
    setSelection(null);
    setOpenId(null);
    setWriting(false);
    setEditing(false);
    setDraft("");
    setError("");
  }, [sessionId, row.id]);

  useEffect(() => {
    if (!stable) return;
    const root = content.current;
    const ranges: Range[] = [];
    const found = new Set<string>();
    if (root) {
      for (const item of annotations) {
        if (item.sourceText !== row.text) continue;
        const range = annotationRange(root, item);
        if (range) {
          ranges.push(range);
          found.add(item.id);
        }
      }
    }
    setValidIds(found);
    highlightRanges.set(key, ranges);
    updateHighlights();
    return () => {
      highlightRanges.delete(key);
      updateHighlights();
    };
  }, [annotations, key, row.text, stable]);

  useEffect(() => {
    if (!selection) return;
    const dismiss = (event: PointerEvent) => {
      if (
        !toolbar.current?.contains(event.target as Node) &&
        !content.current?.contains(event.target as Node)
      )
        setSelection(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(null);
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [selection]);

  function readSelection() {
    if (!stable || !content.current) return;
    const selected = window.getSelection();
    if (!selected || selected.rangeCount !== 1 || selected.isCollapsed) return;
    const range = selected.getRangeAt(0);
    const root = content.current;
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;
    const selectedText = range.toString();
    if (!selectedText.trim()) return;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(root);
    prefix.setEnd(range.startContainer, range.startOffset);
    const rect = range.getBoundingClientRect();
    setSelection({
      selectedText,
      startOffset: prefix.toString().length,
      top: Math.min(window.innerHeight - 120, rect.bottom + 8),
      left: Math.max(8, Math.min(window.innerWidth - 270, rect.left)),
    });
    setWriting(false);
    setError("");
  }

  async function submit() {
    if (!selection || !draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onCreate({
        messageId: row.id,
        role: row.kind as "user" | "assistant",
        sourceText: row.text,
        selectedText: selection.selectedText,
        startOffset: selection.startOffset,
        comment: draft,
      });
      setSelection(null);
      setWriting(false);
      setDraft("");
      window.getSelection()?.removeAllRanges();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const saveEdit = async () => {
    if (!active || !draft.trim()) return;
    setBusy(true);
    try {
      await onUpdate(active.id, { comment: draft });
      setEditing(false);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-w-0" data-testid={`dsh-annotated-${row.id}`}>
      <div
        ref={content}
        onMouseUp={readSelection}
        onKeyUp={readSelection}
        className="dsh-chat-copy min-w-0"
      >
        {row.kind === "user" ? (
          <p className="whitespace-pre-wrap break-words">{row.text}</p>
        ) : (
          <MessageResponse
            className="dsh-chat-response"
            streaming={row.id.startsWith("live:")}
            workspacePath={workspacePath}
          >
            {row.text}
          </MessageResponse>
        )}
      </div>
      {stable && (
        <MessageActions className="mt-1 justify-end">
          <MessageAction
            data-testid={`dsh-copy-${row.id}`}
            label={zh ? "复制消息" : "Copy message"}
            tooltip={zh ? "复制消息" : "Copy message"}
            onClick={() => {
              if (!navigator.clipboard) {
                toast(zh ? "复制失败" : "Copy failed", { variant: "warning" });
                return;
              }
              void navigator.clipboard.writeText(row.text).then(
                () => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1200);
                },
                () => toast(zh ? "复制失败" : "Copy failed", { variant: "warning" }),
              );
            }}
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </MessageAction>
        </MessageActions>
      )}
      {annotations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" data-testid="dsh-annotation-markers">
          {annotations.map((item) => {
            const valid = validIds.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                title={item.comment}
                aria-label={`${zh ? "批注" : "Annotation"} ${item.number}: ${item.comment}`}
                onClick={() => {
                  setOpenId(item.id);
                  setDraft(item.comment);
                  setEditing(false);
                  setSelection(null);
                }}
                className={`rounded border border-border px-1.5 py-0.5 text-ui-xs hover:bg-surface-hover ${item.status === "resolved" ? "opacity-45" : "text-foreground-subtle"}`}
              >
                {item.number}
                {!valid ? " !" : ""}
              </button>
            );
          })}
        </div>
      )}
      {selection &&
        createPortal(
          <div
            ref={toolbar}
            role="toolbar"
            aria-label={zh ? "选中文字" : "Selected text"}
            style={{ position: "fixed", top: selection.top, left: selection.left }}
            className="z-[80] w-fit max-w-72 rounded-lg border border-border bg-popover p-1.5 text-ui-sm text-popover-foreground shadow-lg"
            onMouseDown={(event) => {
              if (!writing) event.preventDefault();
            }}
          >
            {!writing ? (
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setWriting(true);
                    setDraft("");
                  }}
                >
                  {zh ? "添加批注" : "Annotate"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    void navigator.clipboard.writeText(selection.selectedText);
                    setSelection(null);
                  }}
                >
                  {zh ? "复制" : "Copy"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    onAsk(selection.selectedText);
                    setSelection(null);
                  }}
                >
                  {zh ? "询问 AI" : "Ask AI"}
                </Button>
              </div>
            ) : (
              <div className="w-64 space-y-2 p-1">
                <p className="line-clamp-2 text-ui-xs text-foreground-subtle">
                  “{selection.selectedText}”
                </p>
                <textarea
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  aria-label={zh ? "批注意见" : "Annotation comment"}
                  className="min-h-16 w-full resize-y rounded border border-border bg-background p-2 text-ui-sm outline-none"
                />
                <div className="flex justify-end gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelection(null)}
                  >
                    {zh ? "取消" : "Cancel"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || !draft.trim()}
                    onClick={() => void submit()}
                  >
                    {zh ? "添加" : "Add"}
                  </Button>
                </div>
                {error && (
                  <p role="alert" className="text-ui-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
      {active && (
        <div
          role="dialog"
          aria-label={`${zh ? "批注" : "Annotation"} ${active.number}`}
          className="mt-2 max-w-lg rounded-lg border border-border bg-popover p-3 text-ui-sm shadow-md"
        >
          <div className="flex items-center justify-between">
            <strong>
              {zh ? "批注" : "Annotation"} {active.number}
            </strong>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpenId(null)}>
              ×
            </Button>
          </div>
          <p className="mt-2 text-ui-xs text-foreground-subtle">
            {zh ? "原文" : "Quote"}：{active.selectedText}
          </p>
          {!validIds.has(active.id) && (
            <p className="mt-1 text-ui-xs text-warning">
              {zh ? "批注位置已失效" : "Annotation anchor is invalid"}
            </p>
          )}
          {editing ? (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-label={zh ? "编辑批注" : "Edit annotation"}
              className="mt-2 min-h-16 w-full rounded border border-border bg-background p-2 text-ui-sm"
            />
          ) : (
            <p className="mt-2 whitespace-pre-wrap">{active.comment}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-1">
            {editing ? (
              <Button
                type="button"
                size="sm"
                disabled={busy || !draft.trim()}
                onClick={() => void saveEdit()}
              >
                {zh ? "保存" : "Save"}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(active.comment);
                  setEditing(true);
                }}
              >
                {zh ? "编辑" : "Edit"}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                onAsk(active.selectedText, active.id);
                setOpenId(null);
              }}
            >
              {zh ? "询问 AI" : "Ask AI"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() =>
                void onUpdate(active.id, {
                  status: active.status === "resolved" ? "pending" : "resolved",
                }).catch((cause) => setError(String(cause)))
              }
            >
              {active.status === "resolved"
                ? zh
                  ? "重新打开"
                  : "Reopen"
                : zh
                  ? "已处理"
                  : "Resolve"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() =>
                void onDelete(active.id)
                  .then(() => setOpenId(null))
                  .catch((cause) => setError(String(cause)))
              }
            >
              {zh ? "删除" : "Delete"}
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-ui-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
