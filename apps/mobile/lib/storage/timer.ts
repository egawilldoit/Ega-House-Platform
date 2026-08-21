import * as SecureStore from 'expo-secure-store';

export type TimerMode = 'focus' | 'short_break' | 'long_break';

export const TIMER_STORAGE_VERSION = 1;

export interface PersistedTimerState {
  mode: TimerMode;
  endsAtEpochMs: number | null;
  remainingMsWhenPaused: number | null;
  isRunning: boolean;
  startedAtEpochMs: number | null;
  completedAtEpochMs: number | null;
  linkedTaskId: string | null;
  version: number;
}

export interface TimerStorage {
  load(): Promise<PersistedTimerState | null>;
  save(state: PersistedTimerState): Promise<void>;
  clear(): Promise<void>;
}

export interface ComputedTimerState {
  mode: TimerMode;
  remainingMs: number;
  isRunning: boolean;
  justCompleted: boolean;
  persisted: PersistedTimerState;
}

type PersistedTimerShape = {
  mode: TimerMode;
  endsAtEpochMs: number | null;
  remainingMsWhenPaused: number | null;
  isRunning: boolean;
  startedAtEpochMs: number | null;
  completedAtEpochMs: number | null;
  linkedTaskId: string | null;
  version: number;
};

const TIMER_MODES: TimerMode[] = ['focus', 'short_break', 'long_break'];

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

function isPersistedTimerShape(value: unknown): value is PersistedTimerShape {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    TIMER_MODES.includes(candidate.mode as TimerMode) &&
    isNullableNumber(candidate.endsAtEpochMs) &&
    isNullableNumber(candidate.remainingMsWhenPaused) &&
    typeof candidate.isRunning === 'boolean' &&
    isNullableNumber(candidate.startedAtEpochMs) &&
    isNullableNumber(candidate.completedAtEpochMs) &&
    (candidate.linkedTaskId === null || typeof candidate.linkedTaskId === 'string') &&
    candidate.version === TIMER_STORAGE_VERSION
  );
}

export function parsePersistedTimerState(value: unknown): PersistedTimerState | null {
  if (!isPersistedTimerShape(value)) {
    return null;
  }

  return {
    mode: value.mode,
    endsAtEpochMs: value.endsAtEpochMs,
    remainingMsWhenPaused: value.remainingMsWhenPaused,
    isRunning: value.isRunning,
    startedAtEpochMs: value.startedAtEpochMs,
    completedAtEpochMs: value.completedAtEpochMs,
    linkedTaskId: value.linkedTaskId,
    version: value.version,
  };
}

function deriveRemainingMs(state: PersistedTimerState, now: number): number {
  if (!state.isRunning) {
    return Math.max(0, state.remainingMsWhenPaused ?? 0);
  }

  if (state.endsAtEpochMs === null) {
    return Math.max(0, state.remainingMsWhenPaused ?? 0);
  }

  return Math.max(0, state.endsAtEpochMs - now);
}

export function computeTimerState(
  persisted: PersistedTimerState,
  now: number,
): ComputedTimerState {
  if (persisted.isRunning && persisted.endsAtEpochMs !== null && now >= persisted.endsAtEpochMs) {
    if (persisted.completedAtEpochMs !== null) {
      return {
        mode: persisted.mode,
        remainingMs: 0,
        isRunning: false,
        justCompleted: false,
        persisted: {
          ...persisted,
          isRunning: false,
          endsAtEpochMs: null,
          remainingMsWhenPaused: 0,
        },
      };
    }

    return {
      mode: persisted.mode,
      remainingMs: 0,
      isRunning: false,
      justCompleted: true,
      persisted: {
        ...persisted,
        isRunning: false,
        endsAtEpochMs: null,
        remainingMsWhenPaused: 0,
        completedAtEpochMs: persisted.endsAtEpochMs,
      },
    };
  }

  return {
    mode: persisted.mode,
    remainingMs: deriveRemainingMs(persisted, now),
    isRunning: persisted.isRunning,
    justCompleted: false,
    persisted,
  };
}

export function pauseTimer(state: PersistedTimerState, now: number): PersistedTimerState {
  if (!state.isRunning) {
    return state;
  }

  return {
    ...state,
    isRunning: false,
    endsAtEpochMs: null,
    remainingMsWhenPaused: deriveRemainingMs(state, now),
  };
}

export function resumeTimer(
  state: PersistedTimerState,
  now: number,
  fallbackDurationMs: number,
): PersistedTimerState {
  if (state.isRunning) {
    return state;
  }

  const remaining = state.remainingMsWhenPaused;

  if (remaining !== null && remaining > 0) {
    return {
      ...state,
      isRunning: true,
      endsAtEpochMs: now + remaining,
      remainingMsWhenPaused: null,
      startedAtEpochMs: state.startedAtEpochMs ?? now,
      completedAtEpochMs: null,
    };
  }

  return {
    ...state,
    isRunning: true,
    endsAtEpochMs: now + fallbackDurationMs,
    remainingMsWhenPaused: null,
    startedAtEpochMs: now,
    completedAtEpochMs: null,
  };
}

export class InMemoryTimerStorage implements TimerStorage {
  private state: PersistedTimerState | null = null;

  async load() {
    return this.state;
  }

  async save(state: PersistedTimerState) {
    this.state = state;
  }

  async clear() {
    this.state = null;
  }
}

const TIMER_STORAGE_KEY = 'ega.mobile.timer.v1';

class SecureStoreTimerStorage implements TimerStorage {
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(TIMER_STORAGE_KEY);
      if (!raw) {
        return null;
      }

      return parsePersistedTimerState(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  async save(state: PersistedTimerState) {
    await SecureStore.setItemAsync(TIMER_STORAGE_KEY, JSON.stringify(state));
  }

  async clear() {
    await SecureStore.deleteItemAsync(TIMER_STORAGE_KEY);
  }
}

const fallbackStorage = new InMemoryTimerStorage();
const secureStorage = new SecureStoreTimerStorage();

export const mobileTimerStorage: TimerStorage = {
  async load() {
    const secureState = await secureStorage.load();
    if (secureState) {
      return secureState;
    }

    return fallbackStorage.load();
  },
  async save(state) {
    await Promise.all([secureStorage.save(state), fallbackStorage.save(state)]);
  },
  async clear() {
    await Promise.all([secureStorage.clear(), fallbackStorage.clear()]);
  },
};
