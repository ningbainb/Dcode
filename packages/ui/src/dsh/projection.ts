export interface DshRow {
  id: string;
  kind: "user" | "assistant" | "tool";
  text: string;
  thinking?: string;
  name?: string;
  input?: string;
  state?: "input-available" | "output-available" | "output-error";
}
export interface DshProjection {
  rows: DshRow[];
  busy: boolean;
  error?: string;
  cursor: number;
}
export const emptyProjection = (): DshProjection => ({ rows: [], busy: false, cursor: -1 });
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function textContent(value: unknown, type = "text"): string {
  return Array.isArray(value)
    ? value
        .map(record)
        .filter((block) => block.type === type)
        .map((block) => String(block.text ?? ""))
        .join("")
    : "";
}

/** UI-only projection of native DSH frames. Never writes a second transcript. */
export function projectFrame(state: DshProjection, input: unknown): DshProjection {
  const frame = record(input);
  if (frame.type === "snapshot") {
    let next = emptyProjection();
    for (const event of Array.isArray(frame.records) ? frame.records : [])
      next = projectFrame(next, event);
    const attempt = record(record(frame.assistantStream).activeAttempt);
    if (attempt.attemptId) {
      next = { ...next, busy: true };
      for (const value of Array.isArray(attempt.stream) ? attempt.stream : []) {
        // 重连快照使用 DSH 的紧凑块，不能按实时 delta 直接读取，否则丢失已输出前缀。
        const compact = record(value);
        const chunk =
          compact.type === "text-chunks" || compact.type === "reasoning-chunks"
            ? {
                type: compact.type === "text-chunks" ? "text-delta" : "reasoning-delta",
                text: Array.isArray(compact.texts) ? compact.texts.join("") : "",
              }
            : compact.type === "chunk"
              ? compact.chunk
              : compact;
        next = projectFrame(next, {
          type: "assistant-stream",
          frame: { type: "chunk", attemptId: attempt.attemptId, chunk },
        });
      }
    }
    return next;
  }
  if (frame.type === "assistant-stream") {
    const live = record(frame.frame);
    const id = `live:${String(live.attemptId)}`;
    if (live.type === "start") return { ...state, busy: true };
    if (live.type !== "chunk") return state;
    const chunk = record(live.chunk);
    if (chunk.type !== "text-delta" && chunk.type !== "reasoning-delta") return state;
    const rows = [...state.rows];
    let index = rows.findIndex((row) => row.id === id);
    if (index < 0) {
      index = rows.length;
      rows.push({ id, kind: "assistant", text: "" });
    }
    const old = rows[index]!;
    rows[index] =
      chunk.type === "text-delta"
        ? { ...old, text: old.text + String(chunk.text ?? "") }
        : { ...old, thinking: (old.thinking ?? "") + String(chunk.text ?? "") };
    return { ...state, rows, busy: true };
  }
  if (frame.type !== "event") return state;
  const event = record(frame.event);
  const data = record(event.data);
  const seq = Number(event.seq);
  if (seq <= state.cursor) return state;
  let next = { ...state, cursor: seq };
  if (event.type === "turn/start") return { ...next, busy: true, error: undefined };
  if (event.type === "turn/end") {
    const reason = record(data.reason);
    return {
      ...next,
      busy: false,
      ...(reason.kind === "error"
        ? {
            error: String(
              record(reason.error).message ?? "Model unavailable. Change Model or retry.",
            ),
          }
        : {}),
    };
  }
  if (event.type === "user/message" || event.type === "assistant/message") {
    const assistant = event.type === "assistant/message";
    const message = assistant ? record(data.message) : data;
    // DSH 的插件上下文也使用 user role；按来源区分，不能冒充用户输入。
    const sourceKind = record(message.source).kind;
    if (!assistant && sourceKind && sourceKind !== "user") return next;
    const rows = assistant
      ? next.rows.filter((row) => !row.id.startsWith("live:"))
      : [...next.rows];
    const rawText = textContent(message.content);
    // 批注上下文由 DSH 运行时附在提示词末尾供 Agent 使用；聊天气泡只显示用户原文。
    const text = assistant
      ? rawText
      : (rawText.split("\n\n# DCode conversation annotations\n", 1)[0] ?? rawText);
    const thinking = textContent(message.content, "reasoning");
    if (text || thinking)
      rows.push({ id: `event:${seq}`, kind: assistant ? "assistant" : "user", text, thinking });
    return { ...next, rows };
  }
  if (event.type === "tool/call") {
    return {
      ...next,
      rows: [
        ...next.rows,
        {
          id: `tool:${String(data.callId)}`,
          kind: "tool",
          text: "",
          name: String(data.name),
          input: String(data.arguments ?? ""),
          state: "input-available",
        },
      ],
    };
  }
  if (event.type === "tool/result") {
    const message = record(data.message);
    const legacyBlocks = (Array.isArray(message.content) ? message.content : [])
      .map(record)
      .filter((block) => block.type === "tool-result");
    // DSH 0.1.7 将结果和错误状态放在 tool-role message 本身；旧会话仍可能是嵌套块。
    const results = legacyBlocks.length ? legacyBlocks : message.toolCallId ? [message] : [];
    for (const block of results) {
      next = {
        ...next,
        rows: next.rows.map((row) =>
          row.id === `tool:${String(block.toolCallId)}`
            ? {
                ...row,
                text: textContent(block.content),
                state: block.isError ? "output-error" : "output-available",
              }
            : row,
        ),
      };
    }
  }
  return next;
}
