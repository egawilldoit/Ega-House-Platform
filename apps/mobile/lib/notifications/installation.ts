import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const INSTALLATION_ID_KEY = 'ega.notification.installation_id';

export async function getOrCreateInstallationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  if (existing && existing.trim().length > 0) {
    return existing;
  }

  const newId = await generateInstallationId();
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, newId);
  return newId;
}

export async function getStoredInstallationId(): Promise<string | null> {
  const value = await SecureStore.getItemAsync(INSTALLATION_ID_KEY);
  return value && value.trim().length > 0 ? value : null;
}

async function generateInstallationId(): Promise<string> {
  try {
    if (typeof (Crypto as unknown as { randomUUID?: () => string }).randomUUID === 'function') {
      return (Crypto as unknown as { randomUUID: () => string }).randomUUID();
    }
  } catch {
    // fall through
  }

  // Fallback: generate via getRandomBytes or Math.random (still better than weak)
  try {
    const bytes = await Crypto.getRandomBytesAsync(16);
    // Format as UUID v4
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  } catch {
    // Last resort: Math.random (should be rare)
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}

export async function clearInstallationIdForTesting(): Promise<void> {
  await SecureStore.deleteItemAsync(INSTALLATION_ID_KEY);
}
