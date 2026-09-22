import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface ZCodeDataSizeTelemetryState {
  lastReportedAt?: number;
  reportReservedAt?: number;
}

export async function readZCodeDataSizeTelemetryState(
  stateFile: string,
): Promise<ZCodeDataSizeTelemetryState | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(stateFile, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError("Invalid Dcode data size telemetry state");
    }
    const record = parsed as Record<string, unknown>;
    const state: ZCodeDataSizeTelemetryState = {};
    if (record.lastReportedAt !== undefined) {
      if (typeof record.lastReportedAt !== "number" || !Number.isFinite(record.lastReportedAt)) {
        throw new TypeError("Invalid lastReportedAt in Dcode data size telemetry state");
      }
      state.lastReportedAt = record.lastReportedAt;
    }
    if (record.reportReservedAt !== undefined) {
      if (
        typeof record.reportReservedAt !== "number" ||
        !Number.isFinite(record.reportReservedAt)
      ) {
        throw new TypeError("Invalid reportReservedAt in Dcode data size telemetry state");
      }
      state.reportReservedAt = record.reportReservedAt;
    }
    return state.lastReportedAt === undefined && state.reportReservedAt === undefined
      ? null
      : state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeZCodeDataSizeTelemetryState(
  stateFile: string,
  state: ZCodeDataSizeTelemetryState,
): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  const temporaryFile = `${stateFile}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryFile, `${JSON.stringify(state)}\n`, "utf8");
    await rename(temporaryFile, stateFile);
  } catch (error) {
    await unlink(temporaryFile).catch(() => {});
    throw error;
  }
}
