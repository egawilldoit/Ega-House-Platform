import * as React from 'react';
import { act, create } from 'react-test-renderer';

import { TodayWorkspaceInsights } from '../TodayWorkspaceInsights';

jest.mock('@expo/vector-icons/Ionicons', () => ({
  __esModule: true,
  default: () => null,
}));

describe('TodayWorkspaceInsights', () => {
  it('exposes labeled links for weekly review and friction radar', () => {
    const onOpenReview = jest.fn();
    const onOpenFriction = jest.fn();
    let renderer: ReturnType<typeof create>;

    act(() => {
      renderer = create(
        <TodayWorkspaceInsights
          onOpenReview={onOpenReview}
          onOpenFriction={onOpenFriction}
        />,
      );
    });

    const reviewLink = renderer!.root.findByProps({ testID: 'today-weekly-review-link' });
    const frictionLink = renderer!.root.findByProps({ testID: 'today-friction-link' });

    expect(reviewLink.props.accessibilityRole).toBe('button');
    expect(reviewLink.props.accessibilityLabel).toBe('Open Weekly Review');
    expect(frictionLink.props.accessibilityRole).toBe('button');
    expect(frictionLink.props.accessibilityLabel).toBe('Open Friction Radar');

    act(() => {
      reviewLink.props.onPress();
      frictionLink.props.onPress();
    });

    expect(onOpenReview).toHaveBeenCalledTimes(1);
    expect(onOpenFriction).toHaveBeenCalledTimes(1);
  });
});
