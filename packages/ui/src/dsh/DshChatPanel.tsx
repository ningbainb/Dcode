/* eslint-disable max-lines -- The existing DSH panel owns session projection, composer and local annotation UI state. */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  DshModel,
  DshImageInput,
  DshRuntimeHealth,
  DshSessionAnnotation,
  DshSessionAnnotationInput,
} from "@zcode/services";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { toast } from "@/components/ui/toast.js";
import { ArrowUp, FileDiff, FolderOpen, ImagePlus, ShieldCheck, Sparkles, X } from "lucide-react";
import appLogoUrl from "@/assets/dcode-logo.png";
import { emptyProjection, projectFrame, record, type DshRow } from "./projection.js";
import { getDshCopy } from "./dshCopy.js";
import { DshToolActivity } from "./DshToolActivity.js";
import { DshAnnotatedMessage } from "./DshAnnotatedMessage.js";
import { clearDraftIfUnchanged, draftScopeKey, promoteDraftToSession } from "./composerDrafts.js";
import { resolveZcodeCommandPrompt } from "./zcodeCommandPrompt.js";
import "./dshChatReading.css";
import { ImportedZcodeChatPanel } from "./ImportedZcodeChatPanel.js";
import { needsWindowsAclRepair } from "./windowsAclRepair.js";

const EMPTY_ANNOTATIONS: DshSessionAnnotation[] = [];
const IMAGE_TYPES = new Set<DshImageInput["mediaType"]>([
  "image/png", "image/jpeg", "image/webp", "image/gif",
]);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_COUNT = 20;
const MAX_IMAGE_TOTAL_BYTES = 200 * 1024 * 1024;

async function encodeImage(file: File): Promise<DshImageInput> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image."));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
  return { mediaType: file.type as DshImageInput["mediaType"], data, name: file.name };
}

function ImageDraftItem({ file, remove, zh }: { file: File; remove: () => void; zh: boolean }) {
  const [preview, setPreview] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <span className="flex max-w-52 items-center gap-1.5 rounded-lg border border-border/70 bg-background/60 p-1 text-ui-xs">
      {preview && <img src={preview} alt="" className="size-8 rounded object-cover" />}
      <span className="min-w-0 truncate" title={file.name}>{file.name}</span>
      <button type="button" aria-label={zh ? `移除 ${file.name}` : `Remove ${file.name}`} onClick={remove}
        className="rounded p-1 text-foreground-subtle hover:bg-surface-hover hover:text-foreground">
        <X className="size-3" />
      </button>
    </span>
  );
}

export function DshChatPanel(props: {
  workspacePath: string;
  selectedSessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
  onRefreshSessions: () => void;
  onRefreshGit: () => void;
  onOpenDiff: () => void;
}) {
  return props.selectedSessionId?.startsWith("zcode-import:") ? (
    <ImportedZcodeChatPanel
      workspacePath={props.workspacePath}
      sessionId={props.selectedSessionId}
      onSessionCreated={props.onSessionCreated}
      onRefreshSessions={props.onRefreshSessions}
    />
  ) : (
    <DshLiveChatPanel {...props} />
  );
}

function DshLiveChatPanel({
  workspacePath,
  selectedSessionId,
  onSessionCreated,
  onRefreshSessions,
  onRefreshGit,
  onOpenDiff,
}: {
  workspacePath: string;
  selectedSessionId: string | null;
  onSessionCreated: (sessionId: string) => void;
  onRefreshSessions: () => void;
  onRefreshGit: () => void;
  onOpenDiff: () => void;
}) {
  const { locale } = useZCodeIntl();
  const copy = getDshCopy(locale);
  const zh = locale.startsWith("zh");
  const { dshService: service, commandsService } = useServices();
  const { settings } = useSettings();
  const [health, setHealth] = useState<DshRuntimeHealth>({ state: "starting", generation: 0 });
  const [models, setModels] = useState<DshModel[]>([]);
  const [modelKey, setModelKey] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [imageDrafts, setImageDrafts] = useState<Record<string, File[]>>({});
  const [imagePreview, setImagePreview] = useState<{ url: string; name: string } | null>(null);
  const [projection, setProjection] = useState(emptyProjection);
  const [error, setError] = useState("");
  const [aclRepairBusy, setAclRepairBusy] = useState(false);
  const [aclRepairResult, setAclRepairResult] = useState<{
    workspace: string;
    message: string;
    done: boolean;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [approval, setApproval] = useState<Record<string, unknown> | null>(null);
  const [annotations, setAnnotations] = useState<DshSessionAnnotation[]>([]);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[] | null>(null);
  const selection = useRef({ workspacePath, sessionId: selectedSessionId });
  selection.current = { workspacePath, sessionId: selectedSessionId };
  const loadedSessionRef = useRef("");
  const bottom = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const currentDraftKey = draftScopeKey(workspacePath, selectedSessionId);
  const draft = drafts[currentDraftKey] ?? "";
  const images = imageDrafts[currentDraftKey] ?? [];
  const setDraft = (value: string | ((previous: string) => string)) => {
    setDrafts((previous) => {
      const oldText = previous[currentDraftKey] ?? "";
      const nextText = typeof value === "function" ? value(oldText) : value;
      return { ...previous, [currentDraftKey]: nextText };
    });
  };
  const chatFontSize = settings?.dcodeChatFontSize;
  const chatFontFamily = settings?.dcodeChatFontFamily ?? "default";
  const readingStyle = {
    "--dsh-chat-font-size": chatFontSize ? `${chatFontSize}px` : "inherit",
    "--dsh-chat-font-family":
      chatFontFamily === "mono"
        ? "ui-monospace, SFMono-Regular, Consolas, monospace"
        : chatFontFamily === "system"
          ? "system-ui, sans-serif"
          : "inherit",
  } as CSSProperties;
  const pendingAnnotations = annotations.filter((item) => item.status === "pending");
  const annotationByMessage = useMemo(() => {
    const grouped = new Map<string, DshSessionAnnotation[]>();
    for (const item of annotations)
      grouped.set(item.messageId, [...(grouped.get(item.messageId) ?? []), item]);
    return grouped;
  }, [annotations]);
  const attachedAnnotations =
    selectedAnnotationIds === null
      ? pendingAnnotations
      : annotations.filter(
          (item) => selectedAnnotationIds.includes(item.id) && item.status !== "resolved",
        );
  const generation = useRef(0);
  const model = models.find((item) => `${item.provider}/${item.model}` === modelKey);
  const approvalDescription =
    typeof approval?.reason === "string"
      ? approval.reason
      : typeof approval?.description === "string"
        ? approval.description
        : copy.permissionDescription;
  const workspaceName = workspacePath.split(/[\\/]/).filter(Boolean).at(-1) ?? workspacePath;
  const showAclRepair =
    needsWindowsAclRepair(projection.rows, workspacePath) &&
    !(aclRepairResult?.workspace === workspacePath && aclRepairResult.done);
  const displayRows: Array<DshRow | DshRow[]> = [];
  for (const row of projection.rows) {
    const previous = displayRows.at(-1);
    if (row.kind === "tool") {
      if (Array.isArray(previous)) previous.push(row);
      else displayRows.push([row]);
    } else displayRows.push(row);
  }

  const refresh = useCallback(async () => {
    if (!service) return;
    const scope = workspacePath;
    const current = await service.start();
    const available = await service.listModels();
    if (selection.current.workspacePath !== scope) return;
    setHealth(current);
    setModels(available);
    setModelKey((previous) =>
      available.some((item) => `${item.provider}/${item.model}` === previous)
        ? previous
        : available[0]
          ? `${available[0].provider}/${available[0].model}`
          : "",
    );
  }, [service, workspacePath]);
  const report = (failure: unknown) =>
    setError(failure instanceof Error ? failure.message : String(failure));

  useEffect(() => {
    setProjection(emptyProjection());
    setAnnotations([]);
    setSelectedAnnotationIds(null);
    setApproval(null);
    setError("");
    setAclRepairResult(null);
    setAclRepairBusy(false);
    setPending(false);
    void refresh().catch(report);
  }, [refresh]);
  useEffect(() => {
    if (!service) return;
    let active = true;
    const check = () =>
      void service
        .health()
        .then((value) => {
          if (active) setHealth(value);
        })
        .catch(report);
    const timer = setInterval(check, 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [service]);
  useEffect(() => {
    if (!service) return;
    const listener = service.onEvent((event) => {
      if (event.generation < generation.current) return;
      generation.current = event.generation;
      if (event.type === "runtime") {
        setHealth(event.data as DshRuntimeHealth);
        return;
      }
      if (event.sessionId && event.sessionId !== selection.current.sessionId) return;
      if (event.type === "error") {
        setError(String(event.data));
        setPending(false);
        setProjection((old) => ({ ...old, busy: false }));
        return;
      }
      if (event.type === "approval") {
        setApproval(record(event.data));
        return;
      }
      if (event.type === "approval_end") {
        setApproval(null);
        return;
      }
      setProjection((old) => projectFrame(old, event.data));
      const native = record(record(event.data).event);
      if (native.type === "tool/result" || native.type === "turn/end") onRefreshGit();
      if (native.type === "turn/end") void refresh().catch(report);
    });
    return () => listener.dispose();
  }, [service, onRefreshGit, refresh]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [projection]);
  useEffect(() => {
    const handleModelsChanged = () => void refresh().catch(report);
    window.addEventListener("dcode:dsh-models-changed", handleModelsChanged);
    return () => window.removeEventListener("dcode:dsh-models-changed", handleModelsChanged);
  }, [refresh]);
  useEffect(() => {
    const handleRestarted = () => {
      void refresh().catch(report);
      onRefreshSessions();
      if (selection.current.sessionId) void openSession(selection.current.sessionId);
    };
    window.addEventListener("dcode:dsh-runtime-restarted", handleRestarted);
    return () => window.removeEventListener("dcode:dsh-runtime-restarted", handleRestarted);
  }, [refresh, onRefreshSessions]);

  async function openSession(id: string) {
    if (!service || !id) return;
    const scope = workspacePath;
    loadedSessionRef.current = `${scope}\0${id}`;
    selection.current = { workspacePath: scope, sessionId: id };
    setProjection(emptyProjection());
    setAnnotations([]);
    setSelectedAnnotationIds(null);
    setError("");
    setAclRepairResult(null);
    setApproval(null);
    setPending(true);
    try {
      const [snapshot, storedAnnotations] = await Promise.all([
        service.resumeSession(id),
        service.listSessionAnnotations(id),
      ]);
      if (selection.current.sessionId === id && selection.current.workspacePath === scope) {
        setAnnotations(storedAnnotations);
        setProjection((old) =>
          old.cursor > Number(record(snapshot).cursor) ? old : projectFrame(old, snapshot),
        );
        const pendingApproval = record(record(snapshot).pendingApproval);
        if (pendingApproval.requestId) setApproval(pendingApproval);
      }
    } catch (failure) {
      if (selection.current.sessionId === id && selection.current.workspacePath === scope)
        report(failure);
    } finally {
      if (selection.current.sessionId === id && selection.current.workspacePath === scope)
        setPending(false);
    }
  }
  useEffect(() => {
    setImagePreview(null);
    const key = selectedSessionId ? `${workspacePath}\0${selectedSessionId}` : "";
    if (!key) {
      loadedSessionRef.current = "";
      setProjection(emptyProjection());
      setAnnotations([]);
      setSelectedAnnotationIds(null);
      setApproval(null);
      setError("");
      setPending(false);
      return;
    }
    if (selectedSessionId && loadedSessionRef.current !== key) void openSession(selectedSessionId);
  }, [selectedSessionId, workspacePath]);
  function attachImages(files: FileList | null) {
    if (!files?.length) return;
    const additions = Array.from(files);
    if (additions.some((file) => !IMAGE_TYPES.has(file.type as DshImageInput["mediaType"]))) {
      setError(zh ? "仅支持 PNG、JPEG、WebP 和 GIF 图片。" : "Choose PNG, JPEG, WebP or GIF images.");
      return;
    }
    if (additions.some((file) => file.size < 1 || file.size > MAX_IMAGE_BYTES)) {
      setError(zh ? "单张图片不能超过 20 MiB。" : "Each image must be 20 MiB or smaller.");
      return;
    }
    if (images.length + additions.length > MAX_IMAGE_COUNT ||
        [...images, ...additions].reduce((sum, file) => sum + file.size, 0) > MAX_IMAGE_TOTAL_BYTES) {
      setError(zh ? "最多 20 张图片，总大小不超过 200 MiB。" : "Choose at most 20 images, up to 200 MiB total.");
      return;
    }
    setError("");
    setImageDrafts((old) => ({ ...old, [currentDraftKey]: [...(old[currentDraftKey] ?? []), ...additions] }));
  }
  async function openImageAttachment(attachmentId: string, name?: string) {
    if (!service || !selectedSessionId) return;
    const scope = workspacePath;
    const id = selectedSessionId;
    try {
      const result = await service.readImageAttachment(id, attachmentId);
      if (selection.current.workspacePath !== scope || selection.current.sessionId !== id) return;
      setImagePreview({ url: `data:${result.attachment.mediaType};base64,${result.data}`,
        name: name ?? result.attachment.name ?? (zh ? "图片" : "Image") });
    } catch (failure) { report(failure); }
  }
  async function send() {
    if (!service || (!draft.trim() && images.length === 0) || pending) return;
    const sourceScope = workspacePath;
    const sourceSessionId = selectedSessionId;
    const submittedText = draft;
    const submittedImages = images;
    const wasBusy = projection.busy;
    const annotationIds = selectedAnnotationIds ?? undefined;
    let sentDraftKey = currentDraftKey;
    let id = selectedSessionId;
    setPending(true);
    setError("");
    try {
      // 命令目录由现有 Commands 服务拥有；提交时读取启用状态，避免设置页改动后使用旧缓存。
      const message = submittedText.trim().startsWith("/")
        ? resolveZcodeCommandPrompt(
            submittedText,
            (await commandsService.list({ workspacePath: sourceScope })).commands,
          )
        : submittedText;
      if (!id) {
        const created = await service.createSession(sourceScope, model);
        id = created.id;
        sentDraftKey = draftScopeKey(sourceScope, id);
        setDrafts((old) => promoteDraftToSession(old, currentDraftKey, sentDraftKey));
        setImageDrafts((old) => ({ ...old, [sentDraftKey]: old[currentDraftKey] ?? [], [currentDraftKey]: [] }));
        // 创建会话返回时用户可能已切走；只在原草稿仍被选中时接管当前界面。
        if (
          selection.current.workspacePath === sourceScope &&
          selection.current.sessionId === null
        ) {
          onSessionCreated(id);
          await openSession(id);
        }
        onRefreshSessions();
      }
      setPending(true);
      // 忙碌时沿用会话正在使用的模型，避免排队输入在当前 turn 中途改模型。
      const encodedImages: DshImageInput[] = [];
      for (const file of submittedImages) encodedImages.push(await encodeImage(file));
      await service.sendMessage(id, message, wasBusy ? undefined : model, annotationIds, encodedImages);
      setDrafts((old) => clearDraftIfUnchanged(old, sentDraftKey, submittedText));
      setImageDrafts((old) => old[sentDraftKey] === submittedImages
        ? { ...old, [sentDraftKey]: [] } : old);
      const storedAnnotations = await service.listSessionAnnotations(id);
      if (selection.current.workspacePath === sourceScope && selection.current.sessionId === id) {
        setAnnotations(storedAnnotations);
        setSelectedAnnotationIds(null);
        if (wasBusy) toast(copy.queued, { dedupeKey: `dsh-queued:${id}` });
      }
      await refresh();
    } catch (failure) {
      if (
        selection.current.workspacePath === sourceScope &&
        selection.current.sessionId === (id ?? sourceSessionId)
      )
        report(failure);
    } finally {
      if (
        selection.current.workspacePath === sourceScope &&
        selection.current.sessionId === (id ?? sourceSessionId)
      )
        setPending(false);
    }
  }
  async function answer(allowed: boolean) {
    if (!service || !approval) return;
    try {
      if (selectedSessionId)
        await service.respondApproval(selectedSessionId, String(approval.requestId), allowed);
      setApproval(null);
    } catch (failure) {
      report(failure);
    }
  }
  async function repairWorkspaceAcl() {
    if (!service || aclRepairBusy) return;
    const sourceWorkspace = workspacePath;
    setAclRepairBusy(true);
    setAclRepairResult(null);
    try {
      await service.repairWindowsWorkspaceAcl(sourceWorkspace);
      if (selection.current.workspacePath === sourceWorkspace)
        setAclRepairResult({
          workspace: sourceWorkspace,
          message: zh
            ? "已为当前项目补充所需权限。请重新发送刚才失败的请求。"
            : "Workspace permission repaired. Please resend the failed request.",
          done: true,
        });
    } catch (failure) {
      if (selection.current.workspacePath === sourceWorkspace)
        setAclRepairResult({
          workspace: sourceWorkspace,
          message: failure instanceof Error ? failure.message : String(failure),
          done: false,
        });
    } finally {
      if (selection.current.workspacePath === sourceWorkspace) setAclRepairBusy(false);
    }
  }
  async function createAnnotation(input: DshSessionAnnotationInput) {
    if (!service || !selectedSessionId) return;
    await service.createSessionAnnotation(selectedSessionId, input);
    setAnnotations(await service.listSessionAnnotations(selectedSessionId));
  }
  async function updateAnnotation(
    id: string,
    patch: { comment?: string; status?: "pending" | "sent" | "resolved" },
  ) {
    if (!service || !selectedSessionId) return;
    await service.updateSessionAnnotation(selectedSessionId, id, patch);
    setAnnotations(await service.listSessionAnnotations(selectedSessionId));
  }
  async function deleteAnnotation(id: string) {
    if (!service || !selectedSessionId) return;
    await service.deleteSessionAnnotation(selectedSessionId, id);
    setAnnotations(await service.listSessionAnnotations(selectedSessionId));
    setSelectedAnnotationIds((old) => old?.filter((value) => value !== id) ?? null);
  }
  function askAboutQuote(quote: string, annotationId?: string) {
    setDraft((old) => `${zh ? "关于这段内容：" : "About this passage:"}\n“${quote}”\n\n${old}`);
    if (annotationId) setSelectedAnnotationIds([annotationId]);
    composerInputRef.current?.focus();
  }
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background text-ui-base"
      data-testid="dcode-chat"
    >
      {(error || projection.error || health.error) && (
        <div
          role="alert"
          className="mx-auto mt-4 flex w-full max-w-[840px] items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-ui-sm text-destructive"
        >
          <span>{error || projection.error || health.error}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              selectedSessionId ? void openSession(selectedSessionId) : void refresh().catch(report)
            }
          >
            {copy.retry}
          </Button>
        </div>
      )}
      {(showAclRepair || aclRepairResult?.workspace === workspacePath) && (
        <div
          role="status"
          className="mx-auto mt-4 flex w-full max-w-[840px] items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-ui-sm text-foreground"
          data-testid="dsh-windows-acl-repair"
        >
          <span>
            {aclRepairResult?.workspace === workspacePath
              ? aclRepairResult.message
              : zh
                ? "DSH 无法为当前项目启用 Windows 沙箱。可为当前项目目录补充所需权限。"
                : "DSH could not enable the Windows sandbox for this project. Repair this project's permissions."}
          </span>
          {showAclRepair && (
            <Button
              size="sm"
              variant="outline"
              disabled={aclRepairBusy}
              onClick={() => void repairWorkspaceAcl()}
            >
              {aclRepairBusy
                ? zh
                  ? "修复中…"
                  : "Repairing…"
                : zh
                  ? "修复权限"
                  : "Repair permissions"}
            </Button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="dcode-messages">
        <div
          className={`mx-auto flex min-h-full w-full max-w-[840px] flex-col px-5 pb-6 ${projection.rows.length ? "pt-6" : "justify-center"}`}
        >
          {!projection.rows.length && (
            <div className="mx-auto w-full max-w-[720px] pb-8" data-testid="dsh-empty-state">
              <img src={appLogoUrl} alt="" className="mb-6 size-12 rounded-xl" />
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                {copy.welcome}
              </h2>
              <p className="mt-2 text-ui-base text-foreground-subtle">{copy.welcomeDescription}</p>
              <div
                data-testid="dsh-project-chip"
                className="mt-5 inline-flex max-w-full items-center gap-2 rounded-full border border-border/70 bg-surface/50 px-3 py-1.5 text-ui-xs text-foreground-subtle"
                title={workspacePath}
              >
                <FolderOpen className="size-3.5 shrink-0" />
                <span className="truncate">
                  {copy.project} · {workspaceName}
                </span>
              </div>
              <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {copy.suggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion.title}
                    onClick={() => {
                      setDraft(suggestion.prompt);
                      composerInputRef.current?.focus();
                    }}
                    className="group flex min-h-16 items-start gap-2.5 rounded-xl border border-border/70 bg-surface/40 p-3 text-left text-ui-sm text-foreground transition-colors hover:border-border hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-foreground-subtle group-hover:text-foreground" />
                    <span>{suggestion.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {displayRows.map((item) =>
            Array.isArray(item) ? (
              <DshToolActivity key={item[0]?.id} rows={item} copy={copy} zh={zh} />
            ) : (
              <article
                key={item.id}
                className={`mb-6 flex ${item.kind === "user" ? "justify-end" : "gap-3"}`}
              >
                {item.kind === "assistant" && (
                  <img src={appLogoUrl} alt="" className="mt-0.5 size-7 shrink-0 rounded-lg" />
                )}
                <div
                  style={readingStyle}
                  className={
                    item.kind === "user"
                      ? "max-w-[85%] rounded-2xl rounded-tr-md border border-border/70 bg-surface px-4 py-3 text-foreground"
                      : "min-w-0 flex-1 pt-0.5"
                  }
                >
                  {item.kind === "assistant" && (
                    <div className="mb-2 text-ui-xs font-medium text-foreground-subtle">
                      {copy.message}
                    </div>
                  )}
                  {item.thinking && (
                    <details className="mb-3 rounded-lg border border-border/60 bg-surface/40 px-3 py-2 text-ui-xs text-foreground-subtle">
                      <summary className="cursor-pointer">{copy.thinking}</summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">
                        {item.thinking}
                      </pre>
                    </details>
                  )}
                  <DshAnnotatedMessage
                    row={item}
                    sessionId={selectedSessionId ?? ""}
                    workspacePath={workspacePath}
                    annotations={annotationByMessage.get(item.id) ?? EMPTY_ANNOTATIONS}
                    zh={zh}
                    onCreate={createAnnotation}
                    onUpdate={updateAnnotation}
                    onDelete={deleteAnnotation}
                    onAsk={askAboutQuote}
                  />
                  {!!item.images?.length && (
                    <div className="mt-2 flex flex-wrap gap-1.5" data-testid="dsh-message-images">
                      {item.images.map((image) => (
                        <button key={image.attachmentId} type="button"
                          className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-background/50 px-2 py-1 text-ui-xs text-foreground-subtle hover:bg-surface-hover hover:text-foreground"
                          onClick={() => void openImageAttachment(image.attachmentId, image.name)}>
                          <ImagePlus className="size-3.5" />
                          <span className="max-w-40 truncate">{image.name ?? (zh ? "图片" : "Image")}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            ),
          )}
          {projection.busy && (
            <p role="status" className="flex items-center gap-2 text-ui-xs text-foreground-subtle">
              <span className="size-1.5 animate-pulse rounded-full bg-brand" />
              {copy.working}
            </p>
          )}
          <div ref={bottom} />
        </div>
      </div>
      {approval && (
        <div className="mx-auto w-full max-w-[840px] px-5 pb-2" data-testid="dsh-approval-card">
          <div className="rounded-xl border border-border bg-surface p-4 shadow-lg/10">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="size-4" />
              {copy.permission}
            </div>
            <p className="mt-2 text-ui-sm text-foreground-subtle">{approvalDescription}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void answer(true)}>
                {copy.allowOnce}
              </Button>
              <Button size="sm" variant="outline" onClick={() => void answer(false)}>
                {copy.reject}
              </Button>
            </div>
          </div>
        </div>
      )}
      <form
        className="shrink-0 px-5 pb-4 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {annotations.length > 0 && (
          <details
            className="mx-auto mb-2 w-full max-w-[840px] rounded-lg border border-border/70 bg-surface/60 px-3 py-2 text-ui-xs"
            data-testid="dsh-attached-annotations"
          >
            <summary className="cursor-pointer text-foreground-subtle">
              {zh
                ? attachedAnnotations.length
                  ? `已附加 ${attachedAnnotations.length} 条批注`
                  : `会话批注 ${annotations.length} 条 · 未附加`
                : attachedAnnotations.length
                  ? `${attachedAnnotations.length} annotations attached`
                  : `${annotations.length} annotations · none attached`}
            </summary>
            <div className="mt-2 grid gap-1.5">
              {annotations
                .filter((item) => item.status !== "resolved")
                .map((item) => (
                  <label key={item.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={
                        selectedAnnotationIds === null
                          ? item.status === "pending"
                          : selectedAnnotationIds.includes(item.id)
                      }
                      onChange={(event) => {
                        const current =
                          selectedAnnotationIds ?? pendingAnnotations.map((entry) => entry.id);
                        setSelectedAnnotationIds(
                          event.target.checked
                            ? [...current, item.id]
                            : current.filter((id) => id !== item.id),
                        );
                      }}
                    />
                    <span>
                      {item.number}. {item.comment}
                    </span>
                  </label>
                ))}
            </div>
          </details>
        )}
        <div className="mx-auto w-full max-w-[840px] overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_10px_36px_rgba(0,0,0,0.12)] focus-within:border-foreground-subtle">
          {!!images.length && <div className="flex flex-wrap gap-1.5 px-3 pt-3" data-testid="dsh-image-drafts">
            {images.map((file, index) => <ImageDraftItem key={`${file.name}:${index}`} file={file} zh={zh}
              remove={() => setImageDrafts((old) => ({ ...old,
                [currentDraftKey]: (old[currentDraftKey] ?? []).filter((_, itemIndex) => itemIndex !== index) }))} />)}
          </div>}
          <textarea
            ref={composerInputRef}
            data-testid="dsh-message-input"
            aria-label={zh ? "消息" : "Message"}
            className="block min-h-20 max-h-48 w-full resize-none bg-transparent px-4 pt-3 text-ui-base leading-relaxed text-foreground outline-none placeholder:text-foreground-subtle"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={copy.prompt}
            onKeyDown={(event) => {
              if (event.key === "Escape" && projection.busy && selectedSessionId) {
                event.preventDefault();
                void service?.cancel(selectedSessionId).catch(report);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pt-1">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <input ref={imageInputRef} type="file" className="hidden" multiple
                accept="image/png,image/jpeg,image/webp,image/gif" aria-label={zh ? "选择图片" : "Choose images"}
                onChange={(event) => { attachImages(event.target.files); event.target.value = ""; }} />
              <Button type="button" size="sm" variant="ghost" className="shrink-0 px-2"
                aria-label={zh ? "添加图片" : "Add images"} data-testid="dsh-add-images"
                disabled={pending || health.state !== "ready"}
                onClick={() => imageInputRef.current?.click()}>
                <ImagePlus className="size-4" />
              </Button>
              <span
                data-testid="dsh-current-workspace"
                title={workspacePath}
                className="hidden max-w-28 shrink-0 items-center gap-1.5 truncate border-r border-border/70 pr-2 text-ui-xs text-foreground-subtle md:flex"
              >
                <FolderOpen className="size-3.5 shrink-0" />
                <span className="truncate">{workspaceName}</span>
              </span>
              <select
                data-testid="dsh-model-select"
                aria-label={zh ? "模型" : "Model"}
                className="max-w-52 truncate rounded-md border border-border/70 bg-background/60 px-2 py-1.5 text-ui-xs text-foreground outline-none hover:bg-surface-hover"
                value={modelKey}
                onChange={(event) => setModelKey(event.target.value)}
                disabled={projection.busy}
              >
                {!models.length && <option value="">{copy.noModels}</option>}
                {models.map((item) => (
                  <option
                    key={`${item.provider}/${item.model}`}
                    value={`${item.provider}/${item.model}`}
                  >
                    {item.label}
                  </option>
                ))}
              </select>
              <span
                className="flex shrink-0 items-center gap-1.5 text-ui-xs text-foreground-subtle"
                role="status"
              >
                <span
                  className={`size-1.5 rounded-full ${health.state === "ready" ? "bg-green-500" : "bg-amber-500"}`}
                />
                {health.state === "ready" ? copy.ready : copy.connecting}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                data-testid="dsh-view-changes"
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1.5 text-foreground-subtle"
                onClick={onOpenDiff}
              >
                <FileDiff className="size-3.5" />
                {copy.viewChanges}
              </Button>
              {projection.busy && (
                <Button
                  data-testid="dsh-stop"
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    selectedSessionId && void service?.cancel(selectedSessionId).catch(report)
                  }
                >
                  {copy.stop}
                </Button>
              )}
              <Button
                data-testid="dsh-send"
                type="submit"
                size="sm"
                className="gap-1.5 rounded-lg"
                disabled={pending || (!draft.trim() && images.length === 0) || health.state !== "ready"}
              >
                {projection.busy ? copy.queue : copy.send}
                <ArrowUp className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
        <p className="mx-auto mt-1.5 hidden max-w-[840px] text-right text-ui-xs text-foreground-subtlest sm:block">
          {copy.hint}
        </p>
      </form>
      {imagePreview && <div role="dialog" aria-modal="true" aria-label={imagePreview.name}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6"
        onClick={() => setImagePreview(null)}>
        <div className="relative max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
          <button type="button" aria-label={zh ? "关闭图片" : "Close image"}
            className="absolute right-2 top-2 rounded-full bg-background/90 p-2 text-foreground"
            onClick={() => setImagePreview(null)}><X className="size-4" /></button>
          <img src={imagePreview.url} alt={imagePreview.name} className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain" />
        </div>
      </div>}
    </section>
  );
}
