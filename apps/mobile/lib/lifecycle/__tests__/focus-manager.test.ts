import { focusManager } from '@tanstack/react-query';

import { connectFocusManagerToAppState } from '../focus-manager';

jest.mock('@tanstack/react-query', () => ({
  focusManager: {
    setFocused: jest.fn(),
  },
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
  const emit = (status: 'active' | 'background') => {
    listener?.(status);
  };
  return { appState, emit, subscription };
}

describe('connectFocusManagerToAppState', () => {
  beforeEach(() => {
    mockSetFocused.mockClear();
  });

  it('focuses the manager when the app becomes active', () => {
    const { appState, emit } = makeFakeAppState();

    connectFocusManagerToAppState(appState);
    emit('active');

    expect(mockSetFocused).toHaveBeenCalledWith(true);
  });

  it('unfocuses the manager when the app goes to background', () => {
    const { appState, emit } = makeFakeAppState();

    connectFocusManagerToAppState(appState);
    emit('background');

    expect(mockSetFocused).toHaveBeenCalledWith(false);
  });

  it('maps every transition onto exactly one setFocused call', () => {
    const { appState, emit } = makeFakeAppState();

    connectFocusManagerToAppState(appState);
    emit('background');
    emit('active');
    emit('background');
    emit('active');

    expect(mockSetFocused).toHaveBeenCalledTimes(4);
    expect(mockSetFocused).toHaveBeenNthCalledWith(1, false);
    expect(mockSetFocused).toHaveBeenNthCalledWith(2, true);
    expect(mockSetFocused).toHaveBeenNthCalledWith(3, false);
    expect(mockSetFocused).toHaveBeenNthCalledWith(4, true);
  });

  it('removes the AppState subscription on cleanup', () => {
    const { appState, emit, subscription } = makeFakeAppState();

    const returned = connectFocusManagerToAppState(appState);
    returned.remove();
    emit('active');

    expect(subscription.remove).toHaveBeenCalledTimes(1);
    expect(mockSetFocused).not.toHaveBeenCalled();
  });
});
