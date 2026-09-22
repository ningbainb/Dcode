const DEFAULT_MAX_CHARS = 32_000;

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asText(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function crop(value, limit) {
  const text = asText(value);
  return text.length <= limit
    ? text
    : `${text.slice(0, Math.floor(limit / 2))}\n[ZCode content truncated during import]\n${text.slice(-Math.floor(limit / 2))}`;
}

function toolArguments(value, limit) {
  // DSH's tool-call block requires a JSON string; preserve a source string as a
  // JSON string value instead of passing invalid JSON through to the next model.
  const encoded = JSON.stringify(value ?? {});
  return encoded.length <= limit
    ? encoded
    : JSON.stringify({
        truncatedSourceArguments: crop(encoded, limit - 80),
      });
}

function sourceMessages(archive, maxChars) {
  const source = archive.sourceRows;
  if (!source || !Array.isArray(source.messages) || !Array.isArray(source.parts))
    throw new Error("Imported ZCode archive has no source rows for native continuation.");
  const parts = new Map();
  for (const row of source.parts) {
    const list = parts.get(row.messageId) ?? [];
    list.push(row);
    parts.set(row.messageId, list);
  }
  const textLimit = Math.min(8000, Math.max(80, Math.floor(maxChars / 4)));
  const resultLimit = Math.min(16000, Math.max(120, Math.floor(maxChars / 2)));
  let degradedAttachments = 0;
  const messages = [];
  for (const row of source.messages) {
    const data = parseJson(row.data);
    if (data?.role !== "user" && data?.role !== "assistant") continue;
    const blocks = [];
    const tools = [];
    for (const part of parts.get(row.id) ?? []) {
      const payload = parseJson(part.data);
      if (!payload || typeof payload.type !== "string") continue;
      if (payload.type === "text" && typeof payload.text === "string" && payload.text.trim()) {
        blocks.push({ type: "text", text: crop(payload.text, textLimit) });
      } else if (payload.type === "tool" && data.role === "assistant") {
        const state = payload.state ?? {};
        const name = typeof payload.tool === "string" && payload.tool ? payload.tool : "unknown";
        const callId =
          typeof payload.callID === "string" && payload.callID
            ? payload.callID
            : `zcode-${part.id}`;
        const complete = ["completed", "success", "failed", "error"].includes(state.status);
        const failed = ["failed", "error"].includes(state.status) || !complete;
        const output = complete
          ? (state.output ?? state.error ?? "[No tool output recorded in ZCode]")
          : "The ZCode tool call did not finish. Run it again if needed.";
        tools.push({
          id: callId,
          name,
          arguments: toolArguments(state.input, textLimit),
          output: crop(output, resultLimit),
          failed,
        });
      } else if (["file", "image", "pdf", "attachment"].includes(payload.type)) {
        degradedAttachments += 1;
        blocks.push({
          type: "text",
          text: `[ZCode ${payload.type} attachment was not migrated; reopen the source file if needed.]`,
        });
      }
    }
    const summary = data.summary?.body;
    if (typeof summary === "string" && summary.trim())
      blocks.push({
        type: "text",
        text: `[ZCode compaction summary]\n${crop(summary, textLimit)}`,
      });
    if (blocks.length || tools.length) {
      messages.push({
        role: data.role,
        blocks,
        tools,
        model: typeof data.modelID === "string" ? data.modelID : "imported",
        summary: typeof summary === "string" && !!summary.trim(),
      });
    }
  }
  return { messages, degradedAttachments };
}

function selectMessages(messages, maxChars) {
  const cost = (message) =>
    message.blocks.reduce((n, block) => n + block.text.length, 0) +
    message.tools.reduce((n, tool) => n + tool.arguments.length + tool.output.length, 0);
  const retained = new Set();
  let used = 0;
  const keep = (index) => {
    if (index < 0 || retained.has(index)) return;
    const size = cost(messages[index]);
    if (used + size > maxChars && retained.size > 0) return;
    retained.add(index);
    used += size;
  };
  const firstUser = messages.findIndex((message) => message.role === "user");
  keep(firstUser);
  const lastSummary = messages.findLastIndex((message) => message.summary);
  keep(lastSummary);
  for (let index = messages.length - 1; index >= 0; index -= 1) keep(index);
  return {
    selected: messages.filter((_, index) => retained.has(index)),
    omittedMessages: messages.length - retained.size,
  };
}

/**
 * Converts copied ZCode rows to DSH's native, balanced event vocabulary. Inspired
 * by the MIT-licensed dsh-plugin-session-import event mapper, adapted to DCode's
 * existing archive and pinned DSH 0.1.6-alpha.2 session contract.
 */
export function buildZcodeNativeSeed(archive, { maxChars = DEFAULT_MAX_CHARS } = {}) {
  if (!Number.isInteger(maxChars) || maxChars < 128)
    throw new RangeError("Invalid import context budget.");
  const { messages, degradedAttachments } = sourceMessages(archive, maxChars);
  const { selected, omittedMessages } = selectMessages(messages, maxChars);
  if (selected.length === 0) throw new Error("ZCode session contains no portable messages.");
  const events = [];
  const baseTime = Date.now();
  const push = (type, data, surface = false) => {
    events.push({
      type,
      seq: events.length,
      time: baseTime + events.length,
      data,
      ...(surface ? { surfaceOp: "append" } : {}),
    });
  };
  if (typeof archive.title === "string" && archive.title.trim()) {
    push("session/title", {
      title: archive.title.trim(),
      messageSeqs: [],
      source: { kind: "user" },
    });
  }
  let turn = 0;
  let step = 0;
  let turnOpen = false;
  for (const message of selected) {
    if (message.role === "user" || !turnOpen) {
      if (turnOpen) push("turn/end", { turn, reason: { kind: "completed" } });
      turn += 1;
      step = 0;
      turnOpen = true;
      push("turn/start", { turn });
    }
    step += 1;
    push("step/start", { turn, step });
    if (message.role === "user") {
      push(
        "user/message",
        {
          id: `import-user-${events.length}`,
          role: "user",
          content: message.blocks,
          source: { kind: "user" },
        },
        true,
      );
    } else {
      const content = [
        ...message.blocks,
        ...message.tools.map((tool) => ({
          type: "tool-call",
          id: tool.id,
          name: tool.name,
          arguments: tool.arguments,
        })),
      ];
      push(
        "assistant/message",
        {
          turn,
          step,
          stream: [],
          message: {
            id: `import-assistant-${events.length}`,
            role: "assistant",
            content,
            source: { kind: "model", provider: "zcode-import", model: message.model },
          },
        },
        true,
      );
      for (const tool of message.tools) {
        push("tool/call", {
          turn,
          step,
          callId: tool.id,
          name: tool.name,
          arguments: tool.arguments,
        });
        push(
          "tool/result",
          {
            turn,
            step,
            message: {
              id: `import-tool-${events.length}`,
              role: "user",
              content: [
                {
                  type: "tool-result",
                  toolCallId: tool.id,
                  content: [{ type: "text", text: tool.output }],
                  isError: tool.failed,
                },
              ],
              source: { kind: "tool", callId: tool.id },
            },
          },
          true,
        );
      }
    }
    push("step/end", { turn, step });
  }
  push("turn/end", { turn, reason: { kind: "completed" } });
  return { events, omittedMessages, degradedAttachments };
}
