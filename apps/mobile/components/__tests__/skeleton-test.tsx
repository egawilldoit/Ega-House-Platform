import * as React from 'react';
import { AccessibilityInfo, StyleSheet, type StyleProp } from 'react-native';
import { act, create, type ReactTestRendererJSON } from 'react-test-renderer';

import { SkeletonCard, SkeletonLine } from '../mobile/ui/Skeleton';
import { mobileTheme } from '../mobile/theme';

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

function flattenStyle(style: unknown): Record<string, unknown> {
  return (StyleSheet.flatten(style as StyleProp<unknown>) ?? {}) as Record<string, unknown>;
}

function render(element: React.ReactElement) {
  let renderer: ReturnType<typeof create> | undefined;

  act(() => {
    renderer = create(element);
  });

  return renderer!;
}

function unmount(renderer: ReturnType<typeof create>) {
  act(() => {
    renderer.unmount();
  });
}

async function layout(renderer: ReturnType<typeof create>, testID: string, width: number) {
  const node = collectNodes(renderer.toJSON()).find((candidate) => candidate.props.testID === testID);

  await act(async () => {
    node?.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 20 } } });
    await Promise.resolve();
  });
}

function shimmerNodes(renderer: ReturnType<typeof create>) {
  return collectNodes(renderer.toJSON()).filter((node) => String(node.props.testID).endsWith('-shimmer'));
}

describe('Skeleton', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps SkeletonLine geometry and adds a moving highlight after layout', async () => {
    const renderer = render(<SkeletonLine height={14} testID="line" width={120} />);
    const line = collectNodes(renderer.toJSON()).find((node) => node.props.testID === 'line');
    const before = flattenStyle(line?.props.style);

    expect(before).toMatchObject({
      backgroundColor: mobileTheme.colors.skeleton,
      borderRadius: mobileTheme.radius.sm,
      height: 14,
      width: 120,
    });
    expect(shimmerNodes(renderer)).toHaveLength(0);

    await layout(renderer, 'line', 120);

    const after = flattenStyle(
      collectNodes(renderer.toJSON()).find((node) => node.props.testID === 'line')?.props.style,
    );

    expect(after).toEqual(before);
    expect(shimmerNodes(renderer)).toHaveLength(1);
    unmount(renderer);
  });

  it('keeps SkeletonCard geometry and shimmers the card once', async () => {
    const renderer = render(<SkeletonCard testID="card" />);
    const card = collectNodes(renderer.toJSON()).find((node) => node.props.testID === 'card');
    const before = flattenStyle(card?.props.style);

    expect(before).toMatchObject({
      backgroundColor: mobileTheme.colors.surface,
      borderRadius: mobileTheme.radius.card,
      padding: mobileTheme.spacing.lg,
    });

    await layout(renderer, 'card', 320);

    const after = flattenStyle(
      collectNodes(renderer.toJSON()).find((node) => node.props.testID === 'card')?.props.style,
    );

    expect(after).toEqual(before);
    expect(shimmerNodes(renderer)).toHaveLength(1);
    unmount(renderer);
  });

  it('stays static when reduced motion is enabled', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    const renderer = render(<SkeletonCard testID="card" />);
    await layout(renderer, 'card', 320);

    expect(shimmerNodes(renderer)).toHaveLength(0);
    unmount(renderer);
  });

  it('hides skeleton placeholders from assistive technology', async () => {
    const renderer = render(<SkeletonLine testID="line" />);
    const line = collectNodes(renderer.toJSON()).find((node) => node.props.testID === 'line');

    expect(line?.props.accessibilityElementsHidden).toBe(true);
    expect(line?.props.importantForAccessibility).toBe('no-hide-descendants');
    unmount(renderer);
  });
});
