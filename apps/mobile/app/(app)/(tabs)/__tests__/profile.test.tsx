import * as React from 'react';
import { act, create } from 'react-test-renderer';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
}));

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

const mockSignOut = jest.fn();

jest.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ signOut: mockSignOut, user: { id: 'u-1', email: 'user@example.com' } }),
}));

import ProfileScreen from '../../profile';

function findText(component: ReturnType<typeof create>, text: string) {
  const json = component.toJSON();
  if (!json) {
    return false;
  }
  return JSON.stringify(json).includes(text);
}

describe('ProfileScreen', () => {
  it('renders the identity card and version', () => {
    let component: ReturnType<typeof create>;

    act(() => {
      component = create(<ProfileScreen />);
    });

    expect(findText(component!, 'US')).toBe(true);
    expect(findText(component!, 'user@example.com')).toBe(true);
    expect(findText(component!, 'EGA House · v1.0.0')).toBe(true);
  });

  it('does not render dead settings menu rows', () => {
    let component: ReturnType<typeof create>;

    act(() => {
      component = create(<ProfileScreen />);
    });

    for (const label of ['Account Settings', 'Appearance', 'Privacy']) {
      expect(findText(component!, label)).toBe(false);
    }
    expect(findText(component!, 'Notifications')).toBe(true);
  });
});
