import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const BEGIN = "<!-- Dcode managed ZCode instructions begin -->";
const END = "<!-- Dcode managed ZCode instructions end -->";

async function readOptional(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function syncZcodeGlobalInstructions(dshHome, {
  userHome = process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir(),
} = {}) {
  const source = await readOptional(join(userHome, ".zcode", "AGENTS.md"));
  if (source?.includes(BEGIN) || source?.includes(END))
    throw new Error("ZCode instructions contain a reserved Dcode marker.");
  const targetPath = join(dshHome, "AGENTS.md");
  const current = await readOptional(targetPath);
  const beginAt = current?.indexOf(BEGIN) ?? -1;
  const endAt = beginAt < 0 ? -1 : current.indexOf(END, beginAt + BEGIN.length);
  if (beginAt >= 0 && endAt < 0)
    throw new Error("Dcode managed instructions in DSH home are incomplete.");
  const preserved = beginAt < 0 ? (current ?? "") : [
    current.slice(0, beginAt).trimEnd(),
    current.slice(endAt + END.length).trimStart(),
  ].filter(Boolean).join("\n\n");
  const instructions = source?.trim();
  const next = instructions
    ? `${preserved.trimEnd()}${preserved.trim() ? "\n\n" : ""}${BEGIN}\n${instructions}\n${END}\n`
    : preserved;
  if (next === current || (current === null && !next)) return false;
  if (!next) {
    await unlink(targetPath);
    return true;
  }
  const temporary = `${targetPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, next, "utf8");
    await rename(temporary, targetPath);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return true;
}
