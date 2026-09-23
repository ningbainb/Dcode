import type { DshRow } from "./projection.js";

function normalizeWorkspacePath(path: string): string {
  return path.replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}

/** Show the repair only for a native DSH ACL failure in the current project. */
export function needsWindowsAclRepair(rows: DshRow[], workspacePath: string): boolean {
  const marker = "SetNamedSecurityInfoW failed (Win32 5): grantWrite(";
  return rows.some((row) => {
    if (row.kind !== "tool" || row.state !== "output-error") return false;
    const start = row.text.indexOf(marker);
    if (start < 0) return false;
    const pathStart = start + marker.length;
    const pathEnd = row.text.indexOf(")", pathStart);
    return (
      pathEnd > pathStart &&
      normalizeWorkspacePath(row.text.slice(pathStart, pathEnd)) ===
        normalizeWorkspacePath(workspacePath)
    );
  });
}
