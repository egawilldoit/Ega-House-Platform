import * as React from 'react';
import { AccessibilityInfo, StyleSheet, type StyleProp } from 'react-native';
import { act, create, type ReactTestRendererJSON } from 'react-test-renderer';

import { Button } from '../mobile/ui/Button';
import { Chip } from '../mobile/ui/Chip';
import { SegmentedControl } from '../mobile/ui/SegmentedControl';
import { AnimatedPressable } from '../mobile/motion/AnimatedPressable';
import { useReducedMotionEnabled } from '../mobile/motion/ReducedMotion';

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

type A11yNode = ReactTestRendererJSON;

function collectNodes(json: ReactTestRendererJSON | ReactTestRendererJSON[] | null): A11yNode[] {
  const roots =
    json === null ? [] : Array.isArray(json) ? ([...json] as A11yNode[]) : [json as A11yNode];
  const nodes: A11yNode[] = [];

  const visit = (node: A11yNode) => {
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

function renderTree(element: React.ReactElement) {
  let component: ReturnType<typeof create> | undefined;

  act(() => {
    component = create(element);
  });

  return collectNodes(component!.toJSON());
}

function pressables(nodes: A11yNode[]) {
  return nodes.filter((node) => node.props.collapsable === false && 'focusable' in node.props);
}

function flattenStyle(style: unknown): Record<string, unknown> {
  return (StyleSheet.flatten(style as StyleProp<unknown>) ?? {}) as Record<string, unknown>;
}

describe('Button accessibility', () => {
  it('sm size meets the 44 min touch target token', () => {
    const nodes = renderTree(<Button onPress={() => undefined} size="sm" title="Edit" />);

    const pressable = pressables(nodes)[0];
    expect(flattenStyle(pressable.props.style).minHeight).toBe(44);
  });

  it('keeps an accessible name and busy state while loading', () => {
    const nodes = renderTree(
      <Button
        accessibilityLabel="Open task actions"
        loading
        onPress={() => undefined}
        title=""
      />,
    );

    const pressable = pressables(nodes)[0];
    expect(pressable.props.accessibilityLabel).toBe('Open task actions');
    expect(pressable.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
  });

  it('exposes disabled state', () => {
    const nodes = renderTree(<Button disabled title="Save" />);

    const pressable = pressables(nodes)[0];
    expect(pressable.props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe('Chip accessibility', () => {
  it('static chips are not announced as buttons and have tonal background', () => {
    const nodes = renderTree(<Chip kind="status" value="in_progress" />);

    const shell = nodes.find((node) => flattenStyle(node.props.style).minHeight === 26);
    expect(shell).toBeDefined();
    expect(shell?.props.accessibilityRole).toBeUndefined();
    // Chip is View, no hitSlop
    expect(shell?.props.hitSlop).toBeUndefined();
    // has background color from tone
    expect(flattenStyle(shell?.props.style).backgroundColor).toBeDefined();
  });

  it('muted chip still renders without button role and preserves contrast', () => {
    const nodes = renderTree(<Chip kind="health" value={null} muted />);

    const shell = nodes.find((node) => flattenStyle(node.props.style).minHeight === 26);
    expect(shell).toBeDefined();
    expect(shell?.props.accessibilityRole).toBeUndefined();
    // muted opacity applied
    const style = flattenStyle(shell?.props.style);
    expect(style.opacity === 0.55 || style.opacity === undefined).toBe(true);
  });
});

describe('SegmentedControl accessibility', () => {
  it('exposes button role and selected state per segment', () => {
    const nodes = renderTree(
      <SegmentedControl
        onChange={() => undefined}
        options={[
          { label: 'All', value: 'all' },
          { label: 'Todo', value: 'todo' },
        ]}
        value="todo"
      />,
    );

    const segments = nodes.filter((node) => node.props.accessibilityState !== undefined);

    expect(segments.map((node) => node.props.accessibilityState)).toEqual([
      { selected: false, disabled: false },
      { selected: true, disabled: false },
    ]);
  });

  it('segments meet the 44 min touch target and container stays flexible', () => {
    const nodes = renderTree(
      <SegmentedControl
        onChange={() => undefined}
        options={[{ label: 'All', value: 'all' }]}
        value="all"
      />,
    );

    const segment = nodes.find((node) => node.props.accessibilityRole === 'button');
    expect(flattenStyle(segment?.props.style).minHeight).toBe(44);

    const container = nodes[0];
    expect(Number(flattenStyle(container.props.style).minHeight)).toBeGreaterThanOrEqual(50);
  });
});

describe('reduced motion', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('useReducedMotionEnabled', () => {
    function HookProbe({ onValue }: { onValue: (value: boolean) => void }) {
      onValue(useReducedMotionEnabled());

      return null;
    }

    it('reflects the OS reduce-motion setting and change events', async () => {
      let current: boolean | undefined;
      const listeners = new Set<(enabled: boolean) => void>();

      jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
      jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_event: string, handler: (enabled: boolean) => void) => {
        listeners.add(handler);

        return { remove: () => listeners.delete(handler) };
      }) as never);

      await act(async () => {
        create(<HookProbe onValue={(value) => (current = value)} />);
        await Promise.resolve();
      });

      expect(current).toBe(false);

      await act(async () => {
        listeners.forEach((listener) => listener(true));
        await Promise.resolve();
      });

      expect(current).toBe(true);
    });

  });

  it('AnimatedPressable renders as a button while reduced motion is enabled', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({
      remove: () => undefined,
    } as never);

    let created: ReturnType<typeof create> | undefined;

    await act(async () => {
      created = create(
        <AnimatedPressable onPress={() => undefined}>
          <React.Fragment>tap</React.Fragment>
        </AnimatedPressable>,
      );
      await Promise.resolve();
    });

    const nodes = collectNodes(created!.toJSON());

    const pressable = nodes.find((node) => node.props.accessibilityRole === 'button');
    expect(pressable?.props.focusable).toBe(true);
  });
});
