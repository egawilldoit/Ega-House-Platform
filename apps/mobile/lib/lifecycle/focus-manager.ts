import { focusManager } from '@tanstack/react-query';
import type { AppStateStatus } from 'react-native';

export type AppStateSubscription = {
  remove(): void;
};

export type AppStateLike = {
  addEventListener(
    type: 'change',
    listener: (status: AppStateStatus) => void,
  ): AppStateSubscription;
};

export function connectFocusManagerToAppState(appState: AppStateLike) {
  return appState.addEventListener('change', (status) => {
    focusManager.setFocused(status === 'active');
  });
}
