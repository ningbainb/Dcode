import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const MAX_COMMENT = 4000;
const MAX_SOURCE = 200000;
const MAX_QUOTE = 12000;

function requireText(value, label, limit) {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Error(`${label} must contain 1–${limit} characters.`);
  return value;
}

function filePath(dataDir, sessionId) {
  requireText(sessionId, "Session ID", 256);
  const hash = createHash("sha256").update(sessionId).digest("hex");
  return join(dataDir, "session-annotations", `${hash}.json`);
}

async function readState(path, sessionId) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (
      value.version !== 1 ||
      value.sessionId !== sessionId ||
      !Number.isSafeInteger(value.nextNumber) ||
      !Array.isArray(value.annotations)
    )
      throw new Error("Conversation annotation data is invalid.");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, sessionId, nextNumber: 1, annotations: [] };
    throw error;
  }
}

async function saveState(path, state) {
  await mkdir(join(path, ".."), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export function buildPromptWithSessionAnnotations(text, annotations) {
  if (!annotations.length) return text;
  const context = annotations
    .map(
      (item) =>
        `## Annotation ${item.number}\nMessage: ${item.messageId} (${item.role})\nOriginal message:\n${item.sourceText}\nSelected text:\n${item.selectedText}\nComment:\n${item.comment}`,
    )
    .join("\n\n");
  return `${text.trimEnd()}\n\n# DCode conversation annotations\nThe following comments refer to exact passages in earlier messages. Address them in the response.\n\n${context}`;
}

export class SessionAnnotationStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.queues = new Map();
  }

  async withState(sessionId, mutate) {
    const previous = this.queues.get(sessionId) ?? Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(async () => {
        const path = filePath(this.dataDir, sessionId);
        const state = await readState(path, sessionId);
        const result = await mutate(state);
        if (result.changed) await saveState(path, state);
        return result.value;
      });
    this.queues.set(sessionId, current);
    try {
      return await current;
    } finally {
      if (this.queues.get(sessionId) === current) this.queues.delete(sessionId);
    }
  }

  list(sessionId) {
    return this.withState(sessionId, (state) => ({ changed: false, value: state.annotations }));
  }

  create(sessionId, input) {
    return this.withState(sessionId, (state) => {
      if (!/^event:\d+$/.test(input.messageId)) throw new Error("Select a completed message.");
      if (!["user", "assistant"].includes(input.role)) throw new Error("Invalid message role.");
      const sourceText = requireText(input.sourceText, "Source message", MAX_SOURCE);
      const selectedText = requireText(input.selectedText, "Selected text", MAX_QUOTE);
      const comment = requireText(input.comment, "Comment", MAX_COMMENT).trim();
      if (!Number.isSafeInteger(input.startOffset) || input.startOffset < 0)
        throw new Error("Invalid selection offset.");
      if (
        state.annotations.some(
          (item) => item.messageId === input.messageId && item.sourceText !== sourceText,
        )
      )
        throw new Error("The message changed. Refresh the conversation and select again.");
      const now = new Date().toISOString();
      const item = {
        id: randomUUID(),
        sessionId,
        messageId: input.messageId,
        role: input.role,
        sourceText,
        selectedText,
        startOffset: input.startOffset,
        comment,
        number: state.nextNumber++,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      };
      state.annotations.push(item);
      return { changed: true, value: item };
    });
  }

  update(sessionId, id, patch) {
    return this.withState(sessionId, (state) => {
      const item = state.annotations.find((value) => value.id === id);
      if (!item) throw new Error("Annotation no longer exists.");
      if (patch.comment !== undefined)
        item.comment = requireText(patch.comment, "Comment", MAX_COMMENT).trim();
      if (patch.status !== undefined) {
        if (!["pending", "sent", "resolved"].includes(patch.status))
          throw new Error("Invalid annotation status.");
        item.status = patch.status;
      }
      item.updatedAt = new Date().toISOString();
      return { changed: true, value: item };
    });
  }

  remove(sessionId, id) {
    return this.withState(sessionId, (state) => {
      const length = state.annotations.length;
      state.annotations = state.annotations.filter((item) => item.id !== id);
      return {
        changed: length !== state.annotations.length,
        value: length !== state.annotations.length,
      };
    });
  }

  removeMessage(sessionId, messageId) {
    return this.withState(sessionId, (state) => {
      const length = state.annotations.length;
      state.annotations = state.annotations.filter((item) => item.messageId !== messageId);
      return {
        changed: length !== state.annotations.length,
        value: length - state.annotations.length,
      };
    });
  }

  selectForPrompt(sessionId, ids) {
    return this.withState(sessionId, (state) => {
      if (ids !== undefined && (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")))
        throw new Error("Invalid annotation selection.");
      const selected =
        ids === undefined
          ? state.annotations.filter((item) => item.status === "pending")
          : state.annotations.filter((item) => ids.includes(item.id) && item.status !== "resolved");
      if (ids && selected.length !== new Set(ids).size)
        throw new Error("One or more selected annotations are unavailable.");
      return { changed: false, value: selected };
    });
  }

  markSent(sessionId, ids) {
    return this.withState(sessionId, (state) => {
      let changed = false;
      for (const item of state.annotations) {
        if (ids.includes(item.id) && item.status === "pending") {
          item.status = "sent";
          item.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
      return { changed, value: undefined };
    });
  }
}
