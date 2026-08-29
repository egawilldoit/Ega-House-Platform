import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { getAppUpdateInfo } from './service';
import { getUpdateService } from './service';
import type { AppUpdateInfo } from './types';

export function useAppUpdateInfo() {
  return useMemo<AppUpdateInfo>(() => getAppUpdateInfo(), []);
}

export function useUpdateService(service = getUpdateService()) {
  const subscribe = useCallback((cb: () => void) => service.subscribe(cb), [service]);
  const getSnapshot = useCallback(() => service.getState(), [service]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const check = useCallback(() => service.check(), [service]);
  const download = useCallback(() => service.download(), [service]);
  const reload = useCallback(() => service.reload(), [service]);
  const info = useMemo(() => service.getInfo(), [service]);

  return { ...state, check, download, reload, info };
}

export function useAppUpdatesFlow() {
  const svc = getUpdateService();
  const { status, isChecking, isDownloading, error, check, download, reload, info } = useUpdateService(svc);

  const runCheck = useCallback(async () => check(), [check]);
  const runDownload = useCallback(async () => download(), [download]);
  const runReload = useCallback(async () => reload(), [reload]);

  return {
    info,
    status,
    isChecking,
    isDownloading,
    error,
    check: runCheck,
    download: runDownload,
    reload: runReload,
  };
}
