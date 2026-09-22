import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { buildZcodeNativeSeed } from "./zcode-native-seed.mjs";

const PREFIX = "zcode-import:";
const MAX_SCAN = 500;

function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function archiveName(sourceId) {
  return `${createHash("sha256").update(sourceId).digest("hex")}.json`;
}

function equalPath(left, right) {
  const normalize = (value) =>
    process.platform === "win32"
      ? value
          .replaceAll("/", "\\")
          .replace(/[\\]+$/, "")
          .toLowerCase()
      : value.replace(/\/$/, "");
  return normalize(left) === normalize(right);
}

/** Read-only ZCode source and independently owned DCode archive. */
export class ZcodeSessionImportStore {
  constructor(dataDir, sourceDbPath = join(homedir(), ".zcode", "cli", "db", "db.sqlite")) {
    this.dataDir = dataDir;
    this.archiveDir = join(dataDir, "imported-zcode-sessions");
    this.sourceDbPath = sourceDbPath;
  }

  destinationWorkspace(sourcePath) {
    const legacyDefault = join(homedir(), ".zcode", "workspace", "default");
    return equalPath(sourcePath, legacyDefault)
      ? join(this.dataDir, "workspace", "default")
      : sourcePath;
  }

  async withSource(callback) {
    try {
      await stat(this.sourceDbPath);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    const db = new DatabaseSync(this.sourceDbPath, { readOnly: true });
    try {
      return callback(db);
    } finally {
      db.close();
    }
  }

  async candidates() {
    const rows = await this.withSource((db) =>
      db
        .prepare(
          `select s.id, s.title, s.directory, s.time_updated updatedAt,
        (select count(*) from message m where m.session_id = s.id) messageCount
       from session s where s.parent_id is null
       order by s.time_updated desc limit ?`,
        )
        .all(MAX_SCAN),
    );
    if (!rows) return [];
    return Promise.all(
      rows
        .filter((row) => row.messageCount > 0)
        .map(async (row) => ({
          sourceId: row.id,
          title: row.title || "Untitled conversation",
          workspacePath: row.directory,
          updatedAt: row.updatedAt,
          messageCount: row.messageCount,
          imported: await this.exists(row.id),
        })),
    );
  }

  async exists(sourceId) {
    try {
      await stat(join(this.archiveDir, archiveName(sourceId)));
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }

  async importSessions(sourceIds) {
    if (
      !Array.isArray(sourceIds) ||
      sourceIds.length > MAX_SCAN ||
      sourceIds.some((id) => typeof id !== "string" || !id || id.length > 256)
    )
      throw new TypeError("Select up to 500 valid ZCode session IDs.");
    const results = [];
    for (const sourceId of [...new Set(sourceIds)]) {
      if (await this.exists(sourceId)) {
        results.push({ sourceId, status: "skipped" });
        continue;
      }
      try {
        const source = await this.withSource((db) => {
          const session = db
            .prepare(
              "select id, title, directory, time_created createdAt, time_updated updatedAt from session where id = ? and parent_id is null",
            )
            .get(sourceId);
          if (!session) return null;
          const messages = db
            .prepare(
              "select id, sequence, time_created createdAt, data from message where session_id = ? order by coalesce(sequence, time_created), time_created, id",
            )
            .all(sourceId);
          const parts = db
            .prepare(
              "select id, message_id messageId, sequence, time_created createdAt, data from part where session_id = ? order by message_id, coalesce(sequence, time_created), time_created, id",
            )
            .all(sourceId);
          return { session, messages, parts };
        });
        if (!source) throw new Error("ZCode session was not found.");
        const partsByMessage = new Map();
        for (const part of source.parts) {
          const collection = partsByMessage.get(part.messageId) ?? [];
          collection.push(part);
          partsByMessage.set(part.messageId, collection);
        }
        const transcript = source.messages
          .map((message) => {
            const data = safeJson(message.data);
            const messageParts = partsByMessage.get(message.id) ?? [];
            return {
              id: message.id,
              role: data.role === "user" ? "user" : "assistant",
              createdAt: message.createdAt,
              text: [
                ...messageParts
                  .map((part) => {
                    const payload = safeJson(part.data);
                    return payload.type === "text" && typeof payload.text === "string"
                      ? payload.text
                      : "";
                  })
                  .filter(Boolean),
                ...(typeof data.summary?.body === "string" && data.summary.body.trim()
                  ? [`[ZCode compaction summary]\n${data.summary.body.trim()}`]
                  : []),
              ].join("\n\n"),
              tools: messageParts.flatMap((part) => {
                const payload = safeJson(part.data);
                if (payload.type !== "tool") return [];
                const state = payload.state ?? {};
                const describe = (value) =>
                  typeof value === "string" ? value : JSON.stringify(value ?? "");
                return [
                  {
                    id: part.id,
                    name: String(payload.tool ?? "Tool"),
                    status: String(state.status ?? ""),
                    title: typeof state.title === "string" ? state.title : "",
                    input: describe(state.input).slice(0, 8000),
                    output: describe(state.output).slice(0, 8000),
                  },
                ];
              }),
            };
          })
          .filter((message) => message.text.trim() || message.tools.length > 0);
        const archive = {
          version: 1,
          id: PREFIX + sourceId,
          sourceId,
          title: source.session.title || "Untitled conversation",
          workspacePath: this.destinationWorkspace(source.session.directory),
          sourceWorkspacePath: source.session.directory,
          createdAt: source.session.createdAt,
          updatedAt: source.session.updatedAt,
          importedAt: new Date().toISOString(),
          transcript,
          sourceRows: source,
        };
        await mkdir(this.archiveDir, { recursive: true });
        const destination = join(this.archiveDir, archiveName(sourceId));
        const temporary = `${destination}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(archive), { flag: "wx", mode: 0o600 });
        await rename(temporary, destination);
        results.push({ sourceId, status: "imported" });
      } catch (error) {
        results.push({
          sourceId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  async list(workspacePath) {
    let names;
    try {
      names = await readdir(this.archiveDir);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const archives = await Promise.all(
      names
        .filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
        .map(async (name) => {
          try {
            return JSON.parse(await readFile(join(this.archiveDir, name), "utf8"));
          } catch {
            throw new Error(`Imported ZCode archive ${name} is unreadable.`);
          }
        }),
    );
    return archives
      .filter((item) => item.version === 1 && equalPath(item.workspacePath, workspacePath))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((item) => ({
        id: item.id,
        title: item.title,
        workspacePath: item.workspacePath,
        source: "zcode",
        updatedAt: item.updatedAt,
      }));
  }

  async readArchive(id) {
    if (typeof id !== "string" || !id.startsWith(PREFIX))
      throw new TypeError("Not an imported ZCode session.");
    const sourceId = id.slice(PREFIX.length);
    if (!sourceId || sourceId.length > 256) throw new TypeError("Invalid imported session ID.");
    const archive = JSON.parse(
      await readFile(join(this.archiveDir, archiveName(sourceId)), "utf8"),
    );
    if (archive.version !== 1 || archive.id !== id)
      throw new Error("Imported session archive is invalid.");
    return archive;
  }

  async read(id) {
    const archive = await this.readArchive(id);
    const native = buildZcodeNativeSeed(archive);
    return {
      id: archive.id,
      title: archive.title,
      workspacePath: archive.workspacePath,
      updatedAt: archive.updatedAt,
      transcript: archive.transcript,
      continuation: {
        omittedMessages: native.omittedMessages,
        degradedAttachments: native.degradedAttachments,
      },
    };
  }
}
