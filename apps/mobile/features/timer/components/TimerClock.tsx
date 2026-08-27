import { useEffect, useState } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { mobileTheme } from '@/components/mobile/theme';
import { formatElapsedClock, projectElapsedSeconds } from '../runtime';

// Capped so HH:MM:SS stays on one line even at Dynamic Type XL.
const CLOCK_MAX_FONT_SCALE = 1.6;

export type TimerClockProps = {
  startedAt: string;
  fallbackLabel: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
};

/**
 * Server-authoritative clock. Owns the 1s projection locally so the parent
 * TimerScreen never rerenders on tick. Pure recomputation from server
 * `startedAt` via `projectElapsedSeconds` — no accumulated counters.
 */
export function TimerClock({ startedAt, fallbackLabel, style, testID }: TimerClockProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const immediate = setTimeout(() => setNowMs(Date.now()), 0);
    const interval = setInterval(() => setNowMs(Date.now()), 1000);

    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [startedAt]);

  const projected = projectElapsedSeconds(startedAt, nowMs);
  const label = projected === null ? fallbackLabel : formatElapsedClock(projected);

  return (
    <Text
      maxFontSizeMultiplier={CLOCK_MAX_FONT_SCALE}
      style={[styles.clock, style]}
      testID={testID ?? 'timer-clock'}
      accessibilityLabel={`Elapsed ${label}`}
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  clock: {
    color: mobileTheme.colors.text,
    fontSize: 56,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -1.4,
    textAlign: 'center',
  },
});
