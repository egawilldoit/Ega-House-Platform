import * as React from 'react';
import { StyleSheet, Text, type StyleProp } from 'react-native';
import { act, create, type ReactTestRendererJSON } from 'react-test-renderer';

import { EmptyState, type EmptyStateVariant } from '../mobile/ui/EmptyState';
import { mobileTheme } from '../mobile/theme';

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

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

function renderState(element: React.ReactElement) {
  let renderer: ReturnType<typeof create> | undefined;

  act(() => {
    renderer = create(element);
  });

  return collectNodes(renderer!.toJSON());
}

function iconTile(nodes: ReactTestRendererJSON[]) {
  return nodes.find((node) => {
    const style = flattenStyle(node.props.style);
    return style.height === 64 && style.width === 64 && typeof style.backgroundColor === 'string';
  });
}

const TONE_BY_VARIANT: Record<EmptyStateVariant, string> = {
  'first-use': mobileTheme.colors.primaryContainer,
  'no-results': mobileTheme.colors.neutralContainer,
  error: mobileTheme.colors.dangerContainer,
  offline: mobileTheme.colors.warningContainer,
};

describe('EmptyState', () => {
  it.each(Object.entries(TONE_BY_VARIANT))('renders the %s variant tile tone', (variant, tone) => {
    const nodes = renderState(
      <EmptyState description="Description" icon="flag-outline" title="Title" variant={variant as EmptyStateVariant} />,
    );

    expect(flattenStyle(iconTile(nodes)?.props.style).backgroundColor).toBe(tone);
  });

  it('renders two rotated background tiles behind the icon tile', () => {
    const nodes = renderState(<EmptyState description="Description" icon="flag-outline" title="Title" />);
    const rotated = nodes.filter((node) => Array.isArray(flattenStyle(node.props.style).transform));

    expect(rotated).toHaveLength(2);
    expect(rotated.map((node) => flattenStyle(node.props.style).transform)).toEqual([
      [{ rotate: '-9deg' }],
      [{ rotate: '8deg' }],
    ]);
  });

  it('replaces the icon tiles with a supplied illustration', () => {
    const nodes = renderState(
      <EmptyState
        description="Description"
        icon="flag-outline"
        illustration={<Text>Custom illustration</Text>}
        title="Title"
      />,
    );

    expect(iconTile(nodes)).toBeUndefined();
    expect(nodes.some((node) => node.children?.includes('Custom illustration'))).toBe(true);
  });

  it('renders primary and secondary actions together', () => {
    const nodes = renderState(
      <EmptyState
        action={<Text>Primary action</Text>}
        description="Description"
        icon="flag-outline"
        secondaryAction={<Text>Secondary action</Text>}
        title="Title"
      />,
    );

    expect(nodes.some((node) => node.children?.includes('Primary action'))).toBe(true);
    expect(nodes.some((node) => node.children?.includes('Secondary action'))).toBe(true);
  });

  it('hides the decorative icon tile from assistive technology', () => {
    const nodes = renderState(<EmptyState description="Description" icon="flag-outline" title="Title" />);
    const media = nodes.find((node) => flattenStyle(node.props.style).width === 112);

    expect(media?.props.accessibilityElementsHidden).toBe(true);
    expect(media?.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});
