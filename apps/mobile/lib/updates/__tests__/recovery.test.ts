import { recoverLatestUpdate } from '../recovery';

function makeUpdates(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    isEnabled: true,
    checkForUpdateAsync: jest.fn(),
    fetchUpdateAsync: jest.fn(),
    reloadAsync: jest.fn(),
    ...overrides,
  };
}

describe('recoverLatestUpdate', () => {
  it('returns disabled without checking when expo-updates is disabled', async () => {
    const updates = makeUpdates({ isEnabled: false });

    await expect(recoverLatestUpdate(updates as never)).resolves.toBe('UPDATES_DISABLED');
    expect(updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it('does not fetch or reload when no update or rollback is available', async () => {
    const updates = makeUpdates({
      checkForUpdateAsync: jest.fn().mockResolvedValue({
        isAvailable: false,
        isRollBackToEmbedded: false,
      }),
    });

    await expect(recoverLatestUpdate(updates as never)).resolves.toBe('NO_UPDATE');
    expect(updates.fetchUpdateAsync).not.toHaveBeenCalled();
    expect(updates.reloadAsync).not.toHaveBeenCalled();
  });

  it('fetches and reloads a newer OTA update', async () => {
    const updates = makeUpdates({
      checkForUpdateAsync: jest.fn().mockResolvedValue({
        isAvailable: true,
        isRollBackToEmbedded: false,
      }),
      fetchUpdateAsync: jest.fn().mockResolvedValue({
        isNew: true,
        isRollBackToEmbedded: false,
      }),
    });

    await expect(recoverLatestUpdate(updates as never)).resolves.toBe('RELOAD_TRIGGERED');
    expect(updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
  });

  it('fetches and reloads an embedded rollback directive', async () => {
    const updates = makeUpdates({
      checkForUpdateAsync: jest.fn().mockResolvedValue({
        isAvailable: false,
        isRollBackToEmbedded: true,
      }),
      fetchUpdateAsync: jest.fn().mockResolvedValue({
        isNew: false,
        isRollBackToEmbedded: true,
      }),
    });

    await expect(recoverLatestUpdate(updates as never)).resolves.toBe('RELOAD_TRIGGERED');
    expect(updates.fetchUpdateAsync).toHaveBeenCalledTimes(1);
    expect(updates.reloadAsync).toHaveBeenCalledTimes(1);
  });
});
