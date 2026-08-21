import {
  computeTimerState,
  InMemoryTimerStorage,
  mobileTimerStorage,
  pauseTimer,
  parsePersistedTimerState,
  resumeTimer,
  TIMER_STORAGE_VERSION,
  type PersistedTimerState,
} from '@/lib/storage/timer';

const mockSecureStoreItems = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStoreItems.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStoreItems.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStoreItems.delete(key);
  }),
}));

function makeRunningState(overrides: Partial<PersistedTimerState> = {}): PersistedTimerState {
  return {
    mode: 'focus',
    endsAtEpochMs: 10_000,
    remainingMsWhenPaused: null,
    isRunning: true,
    startedAtEpochMs: 0,
    completedAtEpochMs: null,
    linkedTaskId: null,
    version: TIMER_STORAGE_VERSION,
    ...overrides,
  };
}

describe('timer storage', () => {
  beforeEach(() => {
    mockSecureStoreItems.clear();
  });

  it('round-trips a persisted timer state', async () => {
    const storage = new InMemoryTimerStorage();
    const state = makeRunningState({ linkedTaskId: 'task-1' });

    await storage.save(state);

    await expect(storage.load()).resolves.toEqual(state);
  });

  it('round-trips through the default composite storage', async () => {
    const state = makeRunningState();

    await mobileTimerStorage.save(state);

    await expect(mobileTimerStorage.load()).resolves.toEqual(state);
    await mobileTimerStorage.clear();
    await expect(mobileTimerStorage.load()).resolves.toBeNull();
  });

  it('returns null for corrupt JSON instead of throwing', async () => {
    mockSecureStoreItems.set('ega.mobile.timer.v1', '{not valid json');

    await expect(mobileTimerStorage.load()).resolves.toBeNull();
  });

  it('returns null for structurally invalid payloads', () => {
    expect(parsePersistedTimerState({ mode: 'nonsense' })).toBeNull();
    expect(parsePersistedTimerState(null)).toBeNull();
    expect(
      parsePersistedTimerState(makeRunningState({ version: TIMER_STORAGE_VERSION + 1 })),
    ).toBeNull();
  });
});

describe('computeTimerState', () => {
  it('derives remaining time from wall clock while running', () => {
    const computed = computeTimerState(makeRunningState(), 4_000);

    expect(computed.remainingMs).toBe(6_000);
    expect(computed.isRunning).toBe(true);
    expect(computed.justCompleted).toBe(false);
  });

  it('reports paused remaining without touching wall clock', () => {
    const paused = pauseTimer(makeRunningState(), 3_000);
    const computed = computeTimerState(paused, 999_999);

    expect(computed.remainingMs).toBe(7_000);
    expect(computed.isRunning).toBe(false);
    expect(computed.justCompleted).toBe(false);
  });

  it('completes exactly once when expired while away', () => {
    const state = makeRunningState();
    const first = computeTimerState(state, 15_000);

    expect(first.justCompleted).toBe(true);
    expect(first.isRunning).toBe(false);
    expect(first.remainingMs).toBe(0);
    expect(first.persisted.completedAtEpochMs).toBe(10_000);

    const second = computeTimerState(first.persisted, 20_000);

    expect(second.justCompleted).toBe(false);
    expect(second.persisted.completedAtEpochMs).toBe(10_000);
  });
});

describe('pause/resume arithmetic', () => {
  it('pause freezes the wall-clock remainder', () => {
    const paused = pauseTimer(makeRunningState(), 2_500);

    expect(paused.isRunning).toBe(false);
    expect(paused.endsAtEpochMs).toBeNull();
    expect(paused.remainingMsWhenPaused).toBe(7_500);
  });

  it('pause on an already paused timer is a no-op', () => {
    const paused = pauseTimer(makeRunningState({ isRunning: false, remainingMsWhenPaused: 5_000 }), 9_000);

    expect(paused.remainingMsWhenPaused).toBe(5_000);
  });

  it('resume shifts the deadline by elapsed pause time', () => {
    const paused = pauseTimer(makeRunningState(), 2_500);
    const resumed = resumeTimer(paused, 60_000, 25 * 60_000);

    expect(resumed.isRunning).toBe(true);
    expect(resumed.endsAtEpochMs).toBe(67_500);
    expect(resumed.remainingMsWhenPaused).toBeNull();
    expect(computeTimerState(resumed, 61_000).remainingMs).toBe(6_500);
  });

  it('resume from zero restarts the full duration', () => {
    const exhausted = makeRunningState({
      isRunning: false,
      endsAtEpochMs: null,
      remainingMsWhenPaused: 0,
    });
    const resumed = resumeTimer(exhausted, 100_000, 300_000);

    expect(resumed.endsAtEpochMs).toBe(400_000);
    expect(computeTimerState(resumed, 100_000).remainingMs).toBe(300_000);
  });
});

describe('clock skew tolerance', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses injected now regardless of Date.now drift', () => {
    const realNowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const state = makeRunningState();

    const beforeDeadline = computeTimerState(state, 9_999);
    expect(beforeDeadline.remainingMs).toBe(1);
    expect(beforeDeadline.justCompleted).toBe(false);

    const atDeadline = computeTimerState(state, 10_000);
    expect(atDeadline.justCompleted).toBe(true);

    expect(realNowSpy).not.toHaveBeenCalled();
  });
});
