import { useContext } from 'react';
import { useWindowDimensions } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

export const NAV_HEIGHT = 72;
export const HORIZONTAL_MARGIN = 24;
export const BOTTOM_GAP = 20;
export const FAB_GAP = 16;
export const CONTENT_GAP = 16;
export const TAB_LABEL_MAX_FONT_SCALE = 1.4;

export const BOTTOM_CHROME_TOKENS = {
  NAV_HEIGHT,
  HORIZONTAL_MARGIN,
  BOTTOM_GAP,
  FAB_GAP,
  CONTENT_GAP,
  TAB_LABEL_MAX_FONT_SCALE,
} as const;

export type BottomChromeMetrics = {
  navBottom: number;
  fabBottom: number;
  contentBottomPadding: number;
  contentBottomPaddingNoFab: number;
  pillWidth: number;
};

export function useBottomChromeMetrics(): BottomChromeMetrics {
  const insets = useContext(SafeAreaInsetsContext);
  const bottomInset = insets?.bottom ?? 0;
  const { width } = useWindowDimensions();
  const navBottom = Math.max(bottomInset, 12) + BOTTOM_GAP;
  const fabBottom = navBottom + NAV_HEIGHT + FAB_GAP;
  const contentBottomPadding = fabBottom + CONTENT_GAP;
  const contentBottomPaddingNoFab = navBottom + NAV_HEIGHT + CONTENT_GAP;
  const pillWidth = Math.max(Math.min(width - HORIZONTAL_MARGIN * 2, 560), 280);
  return {
    navBottom,
    fabBottom,
    contentBottomPadding,
    contentBottomPaddingNoFab,
    pillWidth,
  };
}
