import { useSyncExternalStore } from 'react';

let tasksVersion = 0;
const listeners = new Set<() => void>();

function emitTasksChanged() {
  listeners.forEach((listener) => {
    listener();
  });
}

export function notifyTasksChanged() {
  tasksVersion += 1;
  emitTasksChanged();
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return tasksVersion;
}

export function useTasksVersion() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
