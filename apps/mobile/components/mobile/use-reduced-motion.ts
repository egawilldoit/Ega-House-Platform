import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotionEnabled() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) {
        setReducedMotion(enabled);
      }
    }).catch(() => {
      // Keep default (motion allowed) when the OS query is unavailable.
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}
