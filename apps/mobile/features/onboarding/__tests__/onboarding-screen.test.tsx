import * as React from 'react';
import { type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, create, type ReactTestRendererJSON } from 'react-test-renderer';
import { useRouter } from 'expo-router';

import { OnboardingScreenContent } from '../OnboardingScreen';
import { markOnboardingComplete } from '@/lib/storage/onboarding';

jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/lib/storage/onboarding', () => ({
  markOnboardingComplete: jest.fn(),
}));

const replace = jest.fn();

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

function hasText(nodes: ReactTestRendererJSON[], text: string) {
  return nodes.some((node) => node.children?.includes(text));
}

async function press(nodes: ReactTestRendererJSON[], testID: string) {
  const node = nodes.find((candidate) => candidate.props.testID === testID);
  expect(node).toBeDefined();

  await act(async () => {
    node?.props.onClick({ currentTarget: node, nativeEvent: {}, target: node });
    await Promise.resolve();
  });
}

async function renderScreen() {
  let renderer: ReturnType<typeof create> | undefined;

  await act(async () => {
    renderer = create(<OnboardingScreenContent />);
    await Promise.resolve();
  });

  return renderer!;
}

describe('OnboardingScreenContent', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    replace.mockReset();
    (useRouter as jest.Mock).mockReturnValue({ replace });
    (markOnboardingComplete as jest.Mock).mockReset().mockResolvedValue(undefined);
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('opens on Today with progress and Skip but no Back', async () => {
    const renderer = await renderScreen();
    const nodes = collectNodes(renderer.toJSON());

    expect(hasText(nodes, 'Today')).toBe(true);
    expect(hasText(nodes, 'Plan what matters today.')).toBe(true);
    expect(hasText(nodes, 'Skip')).toBe(true);
    expect(nodes.find((node) => node.props.testID === 'onboarding-back')).toBeUndefined();

    const progress = nodes.find((node) => node.props.accessibilityRole === 'progressbar');
    expect(progress?.props.accessibilityValue).toEqual({ max: 3, min: 1, now: 1 });
    expect(progress?.props.accessibilityLabel).toBe('Step 1 of 3');

    act(() => {
      renderer.unmount();
    });
  });

  it('advances and goes back through the steps', async () => {
    const renderer = await renderScreen();

    await press(collectNodes(renderer.toJSON()), 'onboarding-next');

    let nodes = collectNodes(renderer.toJSON());
    expect(hasText(nodes, 'Work')).toBe(true);
    expect(hasText(nodes, 'Organize tasks and projects without losing context.')).toBe(true);
    expect(nodes.find((node) => node.props.testID === 'onboarding-back')).toBeDefined();

    await press(nodes, 'onboarding-next');

    nodes = collectNodes(renderer.toJSON());
    expect(hasText(nodes, 'Timer')).toBe(true);
    expect(hasText(nodes, 'Get started')).toBe(true);
    expect(hasText(nodes, 'Skip')).toBe(false);
    expect(nodes.find((node) => node.props.accessibilityRole === 'progressbar')?.props.accessibilityValue).toEqual({
      max: 3,
      min: 1,
      now: 3,
    });

    await press(nodes, 'onboarding-back');

    nodes = collectNodes(renderer.toJSON());
    expect(hasText(nodes, 'Work')).toBe(true);
    expect(nodes.find((node) => node.props.accessibilityRole === 'progressbar')?.props.accessibilityValue).toEqual({
      max: 3,
      min: 1,
      now: 2,
    });

    act(() => {
      renderer.unmount();
    });
  });

  it('does not persist completion while navigating between steps', async () => {
    const renderer = await renderScreen();

    await press(collectNodes(renderer.toJSON()), 'onboarding-next');
    await press(collectNodes(renderer.toJSON()), 'onboarding-back');
    await press(collectNodes(renderer.toJSON()), 'onboarding-next');
    await press(collectNodes(renderer.toJSON()), 'onboarding-back');

    expect(markOnboardingComplete).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();

    act(() => {
      renderer.unmount();
    });
  });

  it('persists completion and continues to welcome when skipped', async () => {
    const renderer = await renderScreen();

    await press(collectNodes(renderer.toJSON()), 'onboarding-skip');

    expect(markOnboardingComplete).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/(public)/welcome');

    act(() => {
      renderer.unmount();
    });
  });

  it('persists completion and continues to welcome from the last step', async () => {
    const renderer = await renderScreen();

    await press(collectNodes(renderer.toJSON()), 'onboarding-next');
    await press(collectNodes(renderer.toJSON()), 'onboarding-next');
    await press(collectNodes(renderer.toJSON()), 'onboarding-finish');

    expect(markOnboardingComplete).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/(public)/welcome');

    act(() => {
      renderer.unmount();
    });
  });

  it('switches steps without motion when reduced motion is enabled', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    const renderer = await renderScreen();
    await press(collectNodes(renderer.toJSON()), 'onboarding-next');

    const nodes = collectNodes(renderer.toJSON());
    const step = nodes.find((node) => node.props.testID === 'onboarding-step-2');

    expect(hasText(nodes, 'Work')).toBe(true);
    expect(step?.props.jestAnimatedStyle?.value).toEqual({ opacity: 1, transform: [{ translateX: 0 }] });

    act(() => {
      renderer.unmount();
    });
  });
});
