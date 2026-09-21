import * as React from 'react';
import { act, create, type ReactTestRendererJSON } from 'react-test-renderer';
import { Redirect } from 'expo-router';

import IndexScreen from '../index';
import { useAuth } from '@/lib/auth/auth-context';
import { hasCompletedOnboarding } from '@/lib/storage/onboarding';

jest.mock('expo-router', () => ({
  Redirect: jest.fn(() => null),
}));

jest.mock('@/lib/auth/auth-context', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/lib/storage/onboarding', () => ({
  hasCompletedOnboarding: jest.fn(),
}));

function redirectHrefs() {
  return (Redirect as unknown as jest.Mock).mock.calls.map((call) => (call[0] as { href: string }).href);
}

function collectNodes(json: ReactTestRendererJSON | ReactTestRendererJSON[] | null): ReactTestRendererJSON[] {
  const roots = json === null ? [] : Array.isArray(json) ? json : [json];
  const nodes: ReactTestRendererJSON[] = [];

  const visit = (node: ReactTestRendererJSON) => {
    nodes.push(node);
    for (const child of node.children ?? []) {
      if (typeof child !== 'string') {
        visit(child);
      }
    }
  };

  roots.forEach(visit);

  return nodes;
}

async function renderGate() {
  let renderer: ReturnType<typeof create> | undefined;

  await act(async () => {
    renderer = create(<IndexScreen />);
    await Promise.resolve();
  });

  return renderer!;
}

describe('IndexScreen onboarding gate', () => {
  beforeEach(() => {
    (Redirect as unknown as jest.Mock).mockClear();
    (useAuth as jest.Mock).mockReset();
    (hasCompletedOnboarding as jest.Mock).mockReset();
  });

  it('waits for auth and the onboarding flag before routing', async () => {
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: false, isReady: false });
    (hasCompletedOnboarding as jest.Mock).mockReturnValue(new Promise(() => undefined));

    const renderer = await renderGate();
    const nodes = collectNodes(renderer.toJSON());

    expect(redirectHrefs()).toEqual([]);
    expect(nodes.length).toBeGreaterThan(0);

    act(() => {
      renderer.unmount();
    });
  });

  it('sends unauthenticated first-time users to onboarding', async () => {
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: false, isReady: true });
    (hasCompletedOnboarding as jest.Mock).mockResolvedValue(false);

    const renderer = await renderGate();

    expect(redirectHrefs()).toEqual(['/(public)/onboarding']);

    act(() => {
      renderer.unmount();
    });
  });

  it('sends returning unauthenticated users to welcome', async () => {
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: false, isReady: true });
    (hasCompletedOnboarding as jest.Mock).mockResolvedValue(true);

    const renderer = await renderGate();

    expect(redirectHrefs()).toEqual(['/(public)/welcome']);

    act(() => {
      renderer.unmount();
    });
  });

  it('never gates an authenticated user behind onboarding', async () => {
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: true, isReady: true });
    (hasCompletedOnboarding as jest.Mock).mockResolvedValue(false);

    const renderer = await renderGate();

    expect(redirectHrefs()).toEqual(['/(app)/(tabs)/today']);

    act(() => {
      renderer.unmount();
    });
  });

  it('falls back to welcome when the onboarding flag cannot be read', async () => {
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: false, isReady: true });
    (hasCompletedOnboarding as jest.Mock).mockRejectedValue(new Error('unavailable'));

    const renderer = await renderGate();

    expect(redirectHrefs()).toEqual(['/(public)/welcome']);

    act(() => {
      renderer.unmount();
    });
  });
});
