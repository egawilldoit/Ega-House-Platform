import * as SecureStore from 'expo-secure-store';

export const ONBOARDING_STORAGE_KEY = 'ega.mobile.onboarding.v1';

export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(ONBOARDING_STORAGE_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function markOnboardingComplete(): Promise<void> {
  try {
    await SecureStore.setItemAsync(ONBOARDING_STORAGE_KEY, 'true');
  } catch {
    return;
  }
}
