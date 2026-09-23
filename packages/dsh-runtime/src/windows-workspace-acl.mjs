import { execFile } from "node:child_process";
import { stat, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { isAbsolute, parse } from "node:path";

const execFileAsync = promisify(execFile);
const SID = /S-1-\d+(?:-\d+)+/;

async function execute(command, args) {
  return execFileAsync(command, args, { windowsHide: true, timeout: 15000, maxBuffer: 65536 });
}

export async function grantWindowsWorkspaceOwnerRight(
  workspacePath,
  { platform = process.platform, run = execute } = {},
) {
  if (platform !== "win32") throw new Error("Windows workspace ACL repair is unavailable here.");
  if (typeof workspacePath !== "string" || !isAbsolute(workspacePath))
    throw new Error("Select an absolute local workspace directory.");
  const canonical = await realpath(workspacePath);
  if (!(await stat(canonical)).isDirectory() || canonical === parse(canonical).root)
    throw new Error("Select a project directory, not a drive root.");

  const { stdout } = await run("whoami.exe", ["/user", "/fo", "csv", "/nh"]);
  const sid = String(stdout).match(SID)?.[0];
  if (!sid) throw new Error("Could not identify the current Windows user.");

  // 0.1.7 沙箱新增 Low 标签写入；普通数据盘只有 Modify 时缺 WRITE_OWNER。
  // 只对用户明确选择的目录补此单项权限，不自动退到不受限模式。
  await run("icacls.exe", [canonical, "/grant", `*${sid}:(OI)(CI)(WO)`]);
  return canonical;
}
