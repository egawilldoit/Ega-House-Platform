import { hasCompletedOnboarding, markOnboardingComplete, ONBOARDING_STORAGE_KEY } from '@/lib/storage/onboarding';
import * as SecureStore from 'expo-secure-store';

describe('onboarding storage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the versioned key', () => {
    expect(ONBOARDING_STORAGE_KEY).toBe('ega.mobile.onboarding.v1');
  });

  it('reads completion from the versioned key', async () => {
    const getItem = jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue('true');

    await expect(hasCompletedOnboarding()).resolves.toBe(true);
    expect(getItem).toHaveBeenCalledWith('ega.mobile.onboarding.v1');
  });

  it('treats a missing or unreadable flag as not completed', async () => {
    jest.spyOn(SecureStore, 'getItemAsync').mockResolvedValue(null);
    await expect(hasCompletedOnboarding()).resolves.toBe(false);

    jest.spyOn(SecureStore, 'getItemAsync').mockRejectedValue(new Error('unavailable'));
    await expect(hasCompletedOnboarding()).resolves.toBe(false);
  });

  it('marks completion without throwing when storage is unavailable', async () => {
    const setItem = jest.spyOn(SecureStore, 'setItemAsync').mockResolvedValue(undefined);

    await markOnboardingComplete();
    expect(setItem).toHaveBeenCalledWith('ega.mobile.onboarding.v1', 'true');

    jest.spyOn(SecureStore, 'setItemAsync').mockRejectedValue(new Error('unavailable'));
    await expect(markOnboardingComplete()).resolves.toBeUndefined();
  });
});
