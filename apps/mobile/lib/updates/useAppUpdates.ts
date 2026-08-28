import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { getAppUpdateInfo } from './service';
import { createUpdateService, getUpdateService } from './service';
import type { AppUpdateInfo, UpdateStatus } from './types';

export function useAppUpdateInfo() {
  return useMemo<AppUpdateInfo>(() => getAppUpdateInfo(), []);
}

export function useUpdateService(service = getUpdateService()) {
  const state = useSyncExternalStore(
    (cb) => service.subscribe(cb),
    () => service.getState(),
    () => service.getState()
  );

  const check = useCallback(() => service.check(), [service]);
  const download = useCallback(() => service.download(), [service]);
  const reload = useCallback(() => service.reload(), [service]);
  const info = useMemo(() => service.getInfo(), [service]);

  return { ...state, check, download, reload, info };
}

export function useAppUpdatesFlow() {
  const svc = getUpdateService();
  const { status, isChecking, isDownloading, error, check, download, reload, info } = useUpdateService(svc);
  const [step, setStep] = useState<UpdateStatus>(status);

  useEffect(() => {
    setStep(status);
  }, [status]);

  const runCheck = useCallback(async () => {
    const res = await check();
    return res;
  }, [check]);

  const runDownload = useCallback(async () => {
    const res = await download();
    return res;
  }, [download]);

  const runReload = useCallback(async () => {
    await reload();
  }, [reload]);

  return {
    info,
    status: step,
    isChecking,
    isDownloading,
    error,
    check: runCheck,
    download: runDownload,
    reload: runReload,
  };
}
