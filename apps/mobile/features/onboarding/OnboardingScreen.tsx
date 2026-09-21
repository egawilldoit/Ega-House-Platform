import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/components/mobile/motion/ReducedMotion';
import { mobileTheme } from '@/components/mobile/theme';
import { Button } from '@/components/mobile/ui/Button';
import { markOnboardingComplete } from '@/lib/storage/onboarding';

const ONBOARDING_STEPS = [
  { description: 'Plan what matters today.', icon: 'sunny-outline', title: 'Today' },
  { description: 'Organize tasks and projects without losing context.', icon: 'briefcase-outline', title: 'Work' },
  { description: 'Turn planned work into focused execution.', icon: 'timer-outline', title: 'Timer' },
] as const;

const TRANSITION_MS = 200;

export function OnboardingScreenContent() {
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const [stepIndex, setStepIndex] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const direction = useRef(1);
  const isFirstRender = useRef(true);
  const opacity = useSharedValue(1);
  const translateX = useSharedValue(0);

  const step = ONBOARDING_STEPS[stepIndex];
  const isLastStep = stepIndex === ONBOARDING_STEPS.length - 1;

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (reducedMotion) {
      opacity.value = 1;
      translateX.value = 0;
      return;
    }

    opacity.value = 0;
    translateX.value = direction.current * 18;
    opacity.value = withTiming(1, { duration: TRANSITION_MS });
    translateX.value = withTiming(0, { duration: TRANSITION_MS });
  }, [stepIndex, reducedMotion, opacity, translateX]);

  const stepStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  const finish = useCallback(async () => {
    setFinishing(true);
    await markOnboardingComplete();
    router.replace('/(public)/welcome');
  }, [router]);

  const goToStep = useCallback(
    (nextIndex: number) => {
      direction.current = nextIndex > stepIndex ? 1 : -1;
      setStepIndex(nextIndex);
    },
    [stepIndex],
  );

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <View style={styles.container}>
        <View pointerEvents="none" style={styles.bgCircle1} />
        <View pointerEvents="none" style={styles.bgCircle2} />

        <View style={styles.header}>
          <Text style={styles.brand}>EGA House</Text>
          {!isLastStep ? (
            <Pressable
              accessibilityLabel="Skip onboarding"
              accessibilityRole="button"
              disabled={finishing}
              onPress={finish}
              style={({ pressed }) => [styles.skip, pressed ? styles.skipPressed : null]}
              testID="onboarding-skip"
            >
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
          ) : (
            <View style={styles.skipPlaceholder} />
          )}
        </View>

        <View style={styles.body}>
          <Animated.View style={[styles.stepContent, stepStyle]} testID={`onboarding-step-${stepIndex + 1}`}>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.iconTile}
            >
              <Ionicons name={step.icon} size={34} color={mobileTheme.colors.accentMid} />
            </View>
            <Text accessibilityRole="header" style={styles.title}>
              {step.title}
            </Text>
            <Text style={styles.description}>{step.description}</Text>
          </Animated.View>
        </View>

        <View style={styles.footer}>
          <View
            accessibilityLabel={`Step ${stepIndex + 1} of ${ONBOARDING_STEPS.length}`}
            accessibilityRole="progressbar"
            accessibilityValue={{ max: ONBOARDING_STEPS.length, min: 1, now: stepIndex + 1 }}
            style={styles.dots}
          >
            {ONBOARDING_STEPS.map((item, index) => (
              <View key={item.title} style={[styles.dot, index === stepIndex ? styles.dotActive : null]} />
            ))}
          </View>

          <View style={styles.actions}>
            {stepIndex > 0 ? (
              <Button
                disabled={finishing}
                onPress={() => goToStep(stepIndex - 1)}
                style={styles.secondaryAction}
                testID="onboarding-back"
                textStyle={styles.ghostText}
                title="Back"
                variant="ghost"
              />
            ) : null}
            <Button
              disabled={finishing}
              onPress={isLastStep ? finish : () => goToStep(stepIndex + 1)}
              style={styles.primaryAction}
              testID={isLastStep ? 'onboarding-finish' : 'onboarding-next'}
              title={isLastStep ? 'Get started' : 'Next'}
            />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
  },
  bgCircle1: {
    backgroundColor: mobileTheme.colors.authCircleBlue,
    borderRadius: 160,
    height: 320,
    position: 'absolute',
    right: -80,
    top: -80,
    width: 320,
  },
  bgCircle2: {
    backgroundColor: mobileTheme.colors.authCirclePurple,
    borderRadius: 100,
    bottom: 80,
    height: 200,
    left: -60,
    position: 'absolute',
    width: 200,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  brand: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 2,
    opacity: 0.7,
    textTransform: 'uppercase',
  },
  container: {
    backgroundColor: mobileTheme.colors.authBackground,
    flex: 1,
    padding: mobileTheme.spacing.xl,
  },
  description: {
    color: mobileTheme.colors.authTextMuted,
    fontSize: 16,
    lineHeight: 24,
    marginTop: mobileTheme.spacing.md,
    maxWidth: 300,
    textAlign: 'center',
  },
  dot: {
    backgroundColor: mobileTheme.colors.authTextMuted,
    borderRadius: mobileTheme.radius.pill,
    height: 8,
    width: 8,
  },
  dotActive: {
    backgroundColor: mobileTheme.colors.accent,
    transform: [{ scale: 1.25 }],
  },
  dots: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginBottom: mobileTheme.spacing.lg,
  },
  footer: {
    gap: mobileTheme.spacing.md,
  },
  ghostText: {
    color: mobileTheme.colors.textOnAccent,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: mobileTheme.layout.minTouchTarget,
  },
  iconTile: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.authSurfaceMuted,
    borderColor: mobileTheme.colors.authBorder,
    borderRadius: mobileTheme.radius.hero,
    borderWidth: 1,
    height: 76,
    justifyContent: 'center',
    marginBottom: mobileTheme.spacing.lg,
    width: 76,
  },
  primaryAction: {
    flex: 2,
  },
  safeArea: {
    backgroundColor: mobileTheme.colors.authBackground,
    flex: 1,
  },
  secondaryAction: {
    flex: 1,
  },
  skip: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: mobileTheme.layout.minTouchTarget,
    minWidth: mobileTheme.layout.minTouchTarget,
    paddingHorizontal: mobileTheme.spacing.md,
  },
  skipPlaceholder: {
    width: mobileTheme.layout.minTouchTarget,
  },
  skipPressed: {
    opacity: 0.7,
  },
  skipText: {
    color: mobileTheme.colors.authTextMuted,
    fontSize: 14,
    fontWeight: mobileTheme.font.bold,
  },
  stepContent: {
    alignItems: 'center',
  },
  title: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 36,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -1,
  },
});
