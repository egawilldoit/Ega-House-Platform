import { formatElapsedClock, projectElapsedSeconds } from '../runtime';

describe('timer elapsed projection', () => {
  it('projects elapsed seconds from the authoritative server timestamp', () => {
    const startedAt = '2026-08-22T10:00:00.000Z';
    const nowMs = Date.parse('2026-08-22T10:01:05.000Z');

    expect(projectElapsedSeconds(startedAt, nowMs)).toBe(65);
  });

  it('recomputes from the server timestamp instead of accumulating ticks', () => {
    const startedAt = '2026-08-22T10:00:00.000Z';

    expect(projectElapsedSeconds(startedAt, Date.parse('2026-08-22T12:00:00.500Z'))).toBe(7200);
    expect(projectElapsedSeconds(startedAt, Date.parse('2026-08-22T09:59:59.999Z'))).toBe(0);
  });

  it('clamps to zero when the local clock trails the server start', () => {
    const startedAt = '2026-08-22T10:00:00.000Z';
    const beforeStart = startedAt;

    expect(projectElapsedSeconds(startedAt, Date.parse(beforeStart))).toBe(0);
    expect(projectElapsedSeconds(startedAt, Date.parse('2026-08-22T09:00:00.000Z'))).toBe(0);
  });

  it('floors partial seconds', () => {
    const startedAt = '2026-08-22T10:00:00.000Z';

    expect(projectElapsedSeconds(startedAt, Date.parse('2026-08-22T10:00:02.900Z'))).toBe(2);
  });

  it('returns null for a missing or unparsable server timestamp', () => {
    expect(projectElapsedSeconds('not-a-timestamp', Date.now())).toBeNull();
    expect(projectElapsedSeconds('', Date.now())).toBeNull();
  });
});

describe('formatElapsedClock', () => {
  it('renders mm:ss below one hour', () => {
    expect(formatElapsedClock(0)).toBe('00:00');
    expect(formatElapsedClock(59)).toBe('00:59');
    expect(formatElapsedClock(60)).toBe('01:00');
    expect(formatElapsedClock(3599)).toBe('59:59');
  });

  it('renders h:mm:ss at or above one hour', () => {
    expect(formatElapsedClock(3600)).toBe('1:00:00');
    expect(formatElapsedClock(7325)).toBe('2:02:05');
  });

  it('never renders negative values', () => {
    expect(formatElapsedClock(-30)).toBe('00:00');
  });
});
