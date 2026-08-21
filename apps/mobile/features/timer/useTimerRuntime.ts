import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import {
  computeTimerState,
  mobileTimerStorage,
  pauseTimer,
  resumeTimer,
  type PersistedTimerState,
  type TimerMode,
} from '@/lib/storage/timer';
import { TIMER_MODES } from '@/features/timer/modes';

function initialPersistedState(mode: TimerMode): PersistedTimerState {
  return {
    mode,
    endsAtEpochMs: null,
    remainingMsWhenPaused: TIMER_MODES[mode].minutes * 60_000,
    isRunning: false,
    startedAtEpochMs: null,
    completedAtEpochMs: null,
    linkedTaskId: null,
    version: 1,
  };
}

export interface UseTimerRuntimeResult {
  mode: TimerMode;
  remainingSeconds: number;
  isRunning: boolean;
  totalSeconds: number;
  completedFocusSessions: number;
  completedFocusMinutes: number;
  changeMode: (nextMode: TimerMode) => void;
  resetTimer: () => void;
  toggleTimer: () => void;
}

export function useTimerRuntime(): UseTimerRuntimeResult {
  const persistedRef = useRef<PersistedTimerState>(initialPersistedState('focus'));
  const [mode, setMode] = useState<TimerMode>('focus');
  const [remainingSeconds, setRemainingSeconds] = useState(TIMER_MODES.focus.minutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [completedFocusSessions, setCompletedFocusSessions] = useState(0);
  const [completedFocusMinutes, setCompletedFocusMinutes] = useState(0);

  const applyComputed = useCallback((now: number) => {
    const computed = computeTimerState(persistedRef.current, now);
    persistedRef.current = computed.persisted;
    setMode(computed.mode);
    setIsRunning(computed.isRunning);
    setRemainingSeconds(Math.ceil(computed.remainingMs / 1000));

    if (computed.justCompleted && computed.mode === 'focus') {
      setCompletedFocusSessions((value) => value + 1);
      setCompletedFocusMinutes((value) => value + TIMER_MODES.focus.minutes);
    }

    return computed;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const loaded = await mobileTimerStorage.load();
      if (cancelled) {
        return;
      }

      if (loaded) {
        persistedRef.current = loaded;
      }

      const computed = applyComputed(Date.now());
      await mobileTimerStorage.save(computed.persisted);
    }

    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [applyComputed]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const interval = setInterval(() => {
      const computed = applyComputed(Date.now());

      if (computed.justCompleted || !computed.isRunning) {
        void mobileTimerStorage.save(computed.persisted);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, applyComputed]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'background' || status === 'inactive') {
        void mobileTimerStorage.save(persistedRef.current);
        return;
      }

      if (status === 'active') {
        const computed = applyComputed(Date.now());
        void mobileTimerStorage.save(computed.persisted);
      }
    });

    return () => subscription.remove();
  }, [applyComputed]);

  const changeMode = useCallback(
    (nextMode: TimerMode) => {
      const next = initialPersistedState(nextMode);
      next.linkedTaskId = persistedRef.current.linkedTaskId;
      persistedRef.current = next;
      void mobileTimerStorage.save(next);
      setMode(nextMode);
      setIsRunning(false);
      setRemainingSeconds(TIMER_MODES[nextMode].minutes * 60);
    },
    [],
  );

  const resetTimer = useCallback(() => {
    const current = persistedRef.current;
    const next: PersistedTimerState = {
      ...current,
      endsAtEpochMs: null,
      remainingMsWhenPaused: TIMER_MODES[current.mode].minutes * 60_000,
      isRunning: false,
      startedAtEpochMs: null,
      completedAtEpochMs: null,
    };
    persistedRef.current = next;
    void mobileTimerStorage.save(next);
    setIsRunning(false);
    setRemainingSeconds(TIMER_MODES[current.mode].minutes * 60);
  }, []);

  const toggleTimer = useCallback(() => {
    const current = persistedRef.current;
    const totalMs = TIMER_MODES[current.mode].minutes * 60_000;

    if (!current.isRunning && (current.remainingMsWhenPaused ?? 0) <= 0) {
      const restarted: PersistedTimerState = {
        ...current,
        remainingMsWhenPaused: totalMs,
      };
      const next = resumeTimer(restarted, Date.now(), totalMs);
      persistedRef.current = next;
      void mobileTimerStorage.save(next);
      setIsRunning(true);
      setRemainingSeconds(Math.ceil(totalMs / 1000));
      return;
    }

    const next = current.isRunning
      ? pauseTimer(current, Date.now())
      : resumeTimer(current, Date.now(), totalMs);
    persistedRef.current = next;
    void mobileTimerStorage.save(next);
    setIsRunning(next.isRunning);
    setRemainingSeconds(
      Math.ceil(computeTimerState(next, Date.now()).remainingMs / 1000),
    );
  }, []);

  const totalSeconds = TIMER_MODES[mode].minutes * 60;

  return {
    mode,
    remainingSeconds,
    isRunning,
    totalSeconds,
    completedFocusSessions,
    completedFocusMinutes,
    changeMode,
    resetTimer,
    toggleTimer,
  };
}
