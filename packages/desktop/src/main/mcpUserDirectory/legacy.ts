/**
 * MCP 用户目录模块 - Legacy 迁移
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  McpServerConfig,
  MigrateLegacyCommonMcpRequest,
  MigrateLegacyCommonMcpResult,
} from "@zcode/shared";
import { isRecord, normalizeServerMap } from "./utils.js";

function extractBalancedJson(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (!char) {
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function getLegacyCommonServers(value: unknown): Record<string, McpServerConfig> | null {
  if (!isRecord(value)) {
    return null;
  }

  const mcp = value.mcp;
  if (!isRecord(mcp) || !("mcpServers" in mcp)) {
    return null;
  }

  return normalizeServerMap(mcp.mcpServers);
}

async function readLegacyCommonMcpFromStoreJson(
  storeJsonPath: string,
): Promise<MigrateLegacyCommonMcpResult | null> {
  try {
    const raw = await readFile(storeJsonPath, "utf-8");
    const storeRoot = JSON.parse(raw) as unknown;

    if (!isRecord(storeRoot)) {
      return null;
    }

    const mcpStorageRaw = storeRoot["mcp-storage"];
    if (typeof mcpStorageRaw !== "string") {
      return null;
    }

    const mcpStorage = JSON.parse(mcpStorageRaw) as unknown;
    if (!isRecord(mcpStorage)) {
      return null;
    }

    const state = mcpStorage.state;
    if (!isRecord(state)) {
      return null;
    }

    const config = state.config;
    if (!isRecord(config)) {
      return null;
    }

    const servers = getLegacyCommonServers(config);
    if (servers && Object.keys(servers).length > 0) {
      return {
        servers,
        sourcePath: storeJsonPath,
        totalCount: Object.keys(servers).length,
        importedCount: 0,
        skippedCount: 0,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function extractLegacyCommonMcpFromText(text: string): Record<string, McpServerConfig> | null {
  let searchStart = 0;

  while (searchStart < text.length) {
    const keyIndex = text.indexOf("mcp-config", searchStart);
    if (keyIndex < 0) {
      return null;
    }

    const jsonStart = text.indexOf("{", keyIndex);
    if (jsonStart < 0) {
      return null;
    }

    const jsonText = extractBalancedJson(text, jsonStart);
    if (jsonText) {
      try {
        const parsed = JSON.parse(jsonText) as unknown;
        const servers = getLegacyCommonServers(parsed);
        if (servers) {
          return servers;
        }
      } catch {
        // continue scanning for the next candidate
      }
    }

    searchStart = keyIndex + "mcp-config".length;
  }

  return null;
}

async function readLegacyCommonMcpFromLevelDbDir(
  directoryPath: string,
): Promise<MigrateLegacyCommonMcpResult | null> {
  let entries: Array<{ name: string; fullPath: string }> = [];
  try {
    const dirents = await readdir(directoryPath, { withFileTypes: true });
    entries = dirents
      .filter((entry) => entry.isFile() && /.(?:ldb|log)$/i.test(entry.name))
      .map((entry) => ({
        name: entry.name,
        fullPath: join(directoryPath, entry.name),
      }))
      .sort((left, right) => right.name.localeCompare(left.name, undefined, { numeric: true }));
  } catch {
    return null;
  }

  for (const entry of entries) {
    try {
      const raw = await readFile(entry.fullPath);
      const text = raw.toString("latin1");
      const servers = extractLegacyCommonMcpFromText(text);
      if (servers) {
        return {
          servers,
          sourcePath: entry.fullPath,
          totalCount: Object.keys(servers).length,
          importedCount: 0,
          skippedCount: 0,
        };
      }
    } catch {
      // ignore unreadable candidate files and continue
    }
  }

  return null;
}

function buildLegacyCommonMcpStorageCandidates(request?: MigrateLegacyCommonMcpRequest): string[] {
  const candidates: string[] = [];
  if (request?.legacyStorageDir) {
    candidates.push(request.legacyStorageDir);
  }

  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");

  // 优先从老的 store.json 读取 common MCP 配置
  candidates.push(join(appData, "ai.z.zcode", "store.json"));

  candidates.push(
    join(localAppData, "ai.z.work", "EBWebView", "Default", "Local Storage", "leveldb"),
    join(appData, "Dcode", "Local Storage", "leveldb"),
    join(appData, "Dcode", "Partitions", "zcode-embedded-browser", "Local Storage", "leveldb"),
    join(appData, "Dcode Dev", "Local Storage", "leveldb"),
    join(appData, "Dcode Dev", "Partitions", "zcode-embedded-browser", "Local Storage", "leveldb"),
  );

  return Array.from(new Set(candidates));
}

export async function migrateLegacyCommonMcp(
  request?: MigrateLegacyCommonMcpRequest,
): Promise<MigrateLegacyCommonMcpResult> {
  for (const candidate of buildLegacyCommonMcpStorageCandidates(request)) {
    // 优先尝试从 store.json 读取
    if (candidate.endsWith("store.json")) {
      const result = await readLegacyCommonMcpFromStoreJson(candidate);
      if (result) {
        return result;
      }
    } else {
      // 然后尝试从 leveldb 读取
      const result = await readLegacyCommonMcpFromLevelDbDir(candidate);
      if (result) {
        return result;
      }
    }
  }

  return {
    servers: {},
    totalCount: 0,
    importedCount: 0,
    skippedCount: 0,
  };
}
