import { useCallback, useEffect, useRef, useState } from "react";
import type { BackupStatus, ICloudBackupService } from "@zcode/services";
import { useServices } from "./useServices.js";

export function useCloudBackup(path?: string | null) {
  const { cloudBackupService: service } = useServices();
  const [status, setStatus] = useState<BackupStatus>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const alive = useRef(true),
    generation = useRef(0);
  const refresh = useCallback(async () => {
    if (!service) return;
    const current = ++generation.current;
    try {
      const next = await service.status(path ?? undefined);
      if (alive.current && current === generation.current) setStatus(next);
    } catch (failure) {
      if (alive.current && current === generation.current)
        setError(failure instanceof Error ? failure.message : "Backup unavailable");
    }
  }, [path, service]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 4000);
    return () => {
      alive.current = false;
      generation.current++;
      clearInterval(timer);
    };
  }, [refresh]);
  const run = useCallback(
    async <T>(
      name: string,
      action: (backend: ICloudBackupService) => Promise<T>,
    ): Promise<T | undefined> => {
      if (!service) return undefined;
      setBusy(name);
      setError(undefined);
      try {
        return await action(service);
      } catch (failure) {
        if (alive.current) setError(failure instanceof Error ? failure.message : "Backup failed");
        return undefined;
      } finally {
        if (alive.current) {
          setBusy(undefined);
          await refresh();
        }
      }
    },
    [refresh, service],
  );
  return { status, busy, error, run, refresh };
}
