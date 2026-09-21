import * as React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, create, type ReactTestRendererJSON } from 'react-test-renderer';

import { SegmentedControl } from '../mobile/ui/SegmentedControl';

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

const OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Todo', value: 'todo' },
];

const FRAMES = [
  { x: 0, y: 0, width: 80, height: 44 },
  { x: 84, y: 0, width: 90, height: 44 },
];

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

function segments(renderer: ReturnType<typeof create>) {
  return collectNodes(renderer.toJSON()).filter((node) => node.props.accessibilityRole === 'button');
}

function thumb(renderer: ReturnType<typeof create>) {
  const node = collectNodes(renderer.toJSON()).find((candidate) => String(candidate.props.testID).endsWith('-thumb'));
  const animated = node?.props.jestAnimatedStyle?.value as
    | { opacity: number; transform: Array<{ translateX: number }> }
    | undefined;

  return { animated, node };
}

async function renderControl(value: string, options = OPTIONS) {
  let renderer: ReturnType<typeof create> | undefined;

  await act(async () => {
    renderer = create(<SegmentedControl onChange={() => undefined} options={options} testID="control" value={value} />);
    await Promise.resolve();
  });

  return renderer!;
}

async function flushFrames() {
  await act(async () => {
    jest.advanceTimersByTime(0);
    await Promise.resolve();
  });
}

async function layoutSegments(renderer: ReturnType<typeof create>) {
  const nodes = segments(renderer);

  await act(async () => {
    nodes.forEach((node, index) => {
      node.props.onLayout({ nativeEvent: { layout: FRAMES[index] } });
    });
    await Promise.resolve();
  });
  await flushFrames();
}

async function selectValue(renderer: ReturnType<typeof create>, value: string) {
  await act(async () => {
    renderer.update(<SegmentedControl onChange={() => undefined} options={OPTIONS} testID="control" value={value} />);
    await Promise.resolve();
  });
}

describe('SegmentedControl', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: () => undefined } as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps 44px touch targets and exposes selected state per segment', async () => {
    const renderer = await renderControl('todo');
    const nodes = segments(renderer);

    expect(nodes.map((node) => node.props.accessibilityState)).toEqual([
      { selected: false, disabled: false },
      { selected: true, disabled: false },
    ]);
    expect(nodes.every((node) => node.props.style.some((style: { minHeight?: number }) => style?.minHeight === 44))).toBe(
      true,
    );
  });

  it('disables a single option without disabling the control', async () => {
    const onChange = jest.fn();
    let renderer: ReturnType<typeof create> | undefined;

    await act(async () => {
      renderer = create(
        <SegmentedControl
          onChange={onChange}
          options={[{ label: 'All', value: 'all' }, { label: 'Todo', value: 'todo', disabled: true }]}
          value="all"
        />,
      );
      await Promise.resolve();
    });

    const nodes = segments(renderer!);

    expect(nodes[1].props.accessibilityState).toEqual({ selected: false, disabled: true });
    expect(nodes[0].props.onStartShouldSetResponder()).toBe(true);
    expect(nodes[1].props.onStartShouldSetResponder()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders a measured thumb on the selected segment', async () => {
    const renderer = await renderControl('all');
    await layoutSegments(renderer);

    expect(thumb(renderer).animated).toEqual({ opacity: 1, transform: [{ translateX: 0 }] });
    expect(thumb(renderer).node?.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 44, top: 0, width: 80 })]),
    );
  });

  it('springs the thumb to the next selected segment', async () => {
    const renderer = await renderControl('all');
    await layoutSegments(renderer);

    await selectValue(renderer, 'todo');
    await flushFrames();
    expect(thumb(renderer).animated).toEqual({ opacity: 1, transform: [{ translateX: 0 }] });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(thumb(renderer).animated).toEqual({ opacity: 1, transform: [{ translateX: 84 }] });
    expect(thumb(renderer).node?.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 44, top: 0, width: 90 })]),
    );
  });

  it('settles on the final segment after rapid switching', async () => {
    const renderer = await renderControl('all');
    await layoutSegments(renderer);

    await act(async () => {
      for (const value of ['todo', 'all', 'todo']) {
        renderer.update(<SegmentedControl onChange={() => undefined} options={OPTIONS} testID="control" value={value} />);
      }
      await Promise.resolve();
    });

    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(thumb(renderer).animated).toEqual({ opacity: 1, transform: [{ translateX: 84 }] });
  });

  it('moves the thumb immediately when reduced motion is enabled', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

    const renderer = await renderControl('all');
    await layoutSegments(renderer);
    await selectValue(renderer, 'todo');
    await flushFrames();

    expect(thumb(renderer).animated).toEqual({ opacity: 1, transform: [{ translateX: 84 }] });
  });
});
