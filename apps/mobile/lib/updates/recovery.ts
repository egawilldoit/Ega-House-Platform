import * as Updates from 'expo-updates';

type RecoveryUpdatesModule = Pick<
  typeof Updates,
  'isEnabled' | 'checkForUpdateAsync' | 'fetchUpdateAsync' | 'reloadAsync'
>;

export type OtaRecoveryResult = 'RELOAD_TRIGGERED' | 'NO_UPDATE' | 'UPDATES_DISABLED';

export async function recoverLatestUpdate(
  updates: RecoveryUpdatesModule = Updates
): Promise<OtaRecoveryResult> {
  if (!updates.isEnabled) {
    return 'UPDATES_DISABLED';
  }

  const check = await updates.checkForUpdateAsync();
  if (!check.isAvailable && !check.isRollBackToEmbedded) {
    return 'NO_UPDATE';
  }

  const fetched = await updates.fetchUpdateAsync();
  if (!fetched.isNew && !fetched.isRollBackToEmbedded) {
    return 'NO_UPDATE';
  }

  await updates.reloadAsync();
  return 'RELOAD_TRIGGERED';
}
