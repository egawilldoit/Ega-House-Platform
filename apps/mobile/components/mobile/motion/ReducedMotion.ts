import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled) setReducedMotion(enabled);
      })
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

// Alias for backwards compat with existing AnimatedPressable / use-reduced-motion
export const useReducedMotionEnabled = useReducedMotion;
