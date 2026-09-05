import {
  isSessionNearExpiry,
  SESSION_REFRESH_BUFFER_SECONDS,
} from '../session-expiry';
import { RESUME_REFRESH_BUFFER_SECONDS } from '@/lib/lifecycle/resume-refresh';

const NOW_SECONDS = 1_800_000_000;

describe('shared session-expiry policy', () => {
  it('keeps the canonical 45-second refresh buffer', () => {
    expect(SESSION_REFRESH_BUFFER_SECONDS).toBe(45);
  });

  it('treats expiresAt within the buffer as near expiry', () => {
    expect(isSessionNearExpiry(NOW_SECONDS + 44, NOW_SECONDS)).toBe(true);
    expect(isSessionNearExpiry(NOW_SECONDS - 10, NOW_SECONDS)).toBe(true);
  });

  it('treats the exact boundary deterministically as near expiry', () => {
    expect(isSessionNearExpiry(NOW_SECONDS + 45, NOW_SECONDS)).toBe(true);
    expect(isSessionNearExpiry(NOW_SECONDS + 46, NOW_SECONDS)).toBe(false);
  });

  it('treats a session beyond the buffer as fresh', () => {
    expect(isSessionNearExpiry(NOW_SECONDS + 3600, NOW_SECONDS)).toBe(false);
  });

  it('honors an explicit buffer override for deterministic callers', () => {
    expect(isSessionNearExpiry(NOW_SECONDS + 100, NOW_SECONDS, 120)).toBe(true);
    expect(isSessionNearExpiry(NOW_SECONDS + 100, NOW_SECONDS, 60)).toBe(false);
  });

  it('is the single policy behind the foreground resume default', () => {
    // If these drift apart, bootstrap and foreground refresh disagree on
    // what "near expiry" means. Both must stay on the canonical constant.
    expect(RESUME_REFRESH_BUFFER_SECONDS).toBe(SESSION_REFRESH_BUFFER_SECONDS);
  });
});
