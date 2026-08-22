import { focusManager } from '@tanstack/react-query';

import { connectFocusManagerToAppState } from '../focus-manager';

jest.mock('@tanstack/react-query', () => ({
  focusManager: { setFocused: jest.fn() },
}));

const mockSetFocused = focusManager.setFocused as jest.MockedFunction<
  typeof focusManager.setFocused
>;

type ChangeListener = (status: 'active' | 'background') => void;

function makeFakeAppState() {
  let listener: ChangeListener | null = null;
  const subscription = {
    remove: jest.fn(() => {
      listener = null;
    }),
  };
  const appState = {
    addEventListener: jest.fn((type: string, next: ChangeListener) => {
      expect(type).toBe('change');
      listener = next;
      return subscription;
    }),
  };
  return {
    appState,
    emit(status: 'active' | 'background') {
      listener?.(status);
    },
    subscription,
  };
}

describe('connectFocusManagerToAppState', () => {
  beforeEach(() => mockSetFocused.mockClear());

  it('maps React Native AppState to TanStack Query focus state', () => {
    const { appState, emit } = makeFakeAppState();
    connectFocusManagerToAppState(appState);

    emit('background');
    emit('active');

    expect(mockSetFocused).toHaveBeenNthCalledWith(1, false);
    expect(mockSetFocused).toHaveBeenNthCalledWith(2, true);
  });

  it('removes the AppState listener during cleanup', () => {
    const { appState, emit, subscription } = makeFakeAppState();
    const returned = connectFocusManagerToAppState(appState);

    returned.remove();
    emit('active');

    expect(subscription.remove).toHaveBeenCalledTimes(1);
    expect(mockSetFocused).not.toHaveBeenCalled();
  });
});
