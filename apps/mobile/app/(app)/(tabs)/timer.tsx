import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AnimatedPressable } from '@/components/mobile/AnimatedPressable';
import { MobileScreen, MobileScreenHeader, SurfaceCard } from '@/components/mobile/primitives';
import { mobileTheme } from '@/components/mobile/theme';

type TimerMode = 'focus' | 'short_break' | 'long_break';

const TIMER_MODES: Record<
  TimerMode,
  { label: string; minutes: number; icon: keyof typeof Ionicons.glyphMap }
> = {
  focus: { label: 'Focus', minutes: 25, icon: 'flame-outline' },
  short_break: { label: 'Short Break', minutes: 5, icon: 'cafe-outline' },
  long_break: { label: 'Long Break', minutes: 15, icon: 'hourglass-outline' },
};

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function TimerScreen() {
  const [mode, setMode] = useState<TimerMode>('focus');
  const [remainingSeconds, setRemainingSeconds] = useState(TIMER_MODES.focus.minutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [completedFocusSessions, setCompletedFocusSessions] = useState(0);
  const [completedFocusMinutes, setCompletedFocusMinutes] = useState(0);

  const pulse = useRef(new Animated.Value(0)).current;
  const entrance = useRef(new Animated.Value(0)).current;
  const totalSeconds = TIMER_MODES[mode].minutes * 60;
  const progress = totalSeconds === 0 ? 0 : 1 - remainingSeconds / totalSeconds;
  const progressPercent = Math.round(progress * 100);

  const entranceStyle = useMemo(
    () => ({
      opacity: entrance,
      transform: [
        {
          translateY: entrance.interpolate({
            inputRange: [0, 1],
            outputRange: [12, 0],
          }),
        },
      ],
    }),
    [entrance],
  );

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.04],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.55],
  });

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance]);

  useEffect(() => {
    if (!isRunning) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();

    return () => loop.stop();
  }, [isRunning, pulse]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const interval = setInterval(() => {
      setRemainingSeconds((current) => {
        if (current <= 1) {
          clearInterval(interval);
          setIsRunning(false);

          if (mode === 'focus') {
            setCompletedFocusSessions((value) => value + 1);
            setCompletedFocusMinutes((value) => value + TIMER_MODES.focus.minutes);
          }

          return 0;
        }

        return current - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, mode]);

  function changeMode(nextMode: TimerMode) {
    setMode(nextMode);
    setIsRunning(false);
    setRemainingSeconds(TIMER_MODES[nextMode].minutes * 60);
  }

  function resetTimer() {
    setIsRunning(false);
    setRemainingSeconds(totalSeconds);
  }

  function toggleTimer() {
    if (remainingSeconds <= 0) {
      setRemainingSeconds(totalSeconds);
      setIsRunning(true);
      return;
    }

    setIsRunning((current) => !current);
  }

  return (
    <MobileScreen padded={false}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MobileScreenHeader
          eyebrow="Focus"
          title="Timer"
          description={isRunning ? 'Session running' : 'Ready when you are'}
        />

        <Animated.View style={[styles.animatedSection, entranceStyle]}>
          <View style={styles.sessionRow}>
            {(Object.keys(TIMER_MODES) as TimerMode[]).map((item) => {
              const active = item === mode;

              return (
                <Pressable
                  key={item}
                  disabled={isRunning}
                  onPress={() => changeMode(item)}
                  style={[
                    styles.sessionChip,
                    active ? styles.sessionChipActive : null,
                    isRunning && !active ? styles.sessionChipDisabled : null,
                  ]}
                >
                  <Ionicons
                    color={
                      active ? mobileTheme.colors.textOnAccent : mobileTheme.colors.textMuted
                    }
                    name={TIMER_MODES[item].icon}
                    size={14}
                  />
                  <Text
                    style={[
                      styles.sessionChipText,
                      active ? styles.sessionChipTextActive : null,
                    ]}
                  >
                    {TIMER_MODES[item].label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>

        <Animated.View style={[styles.animatedSection, entranceStyle]}>
          <SurfaceCard style={styles.timerCard}>
            <View style={styles.clockContainer}>
              <View style={styles.clockRing}>
                <Animated.View
                  style={[
                    styles.pulseRing,
                    {
                      opacity: pulseOpacity,
                      transform: [{ scale: pulseScale }],
                    },
                  ]}
                />
                <View style={styles.progressRing}>
                  <Text style={styles.progressText}>{progressPercent}%</Text>
                </View>
                <View style={styles.clockFace}>
                  <Text style={styles.timeDisplay}>{formatTime(remainingSeconds)}</Text>
                  <View style={styles.modeLabelRow}>
                    <Ionicons
                      color={mobileTheme.colors.accent}
                      name={TIMER_MODES[mode].icon}
                      size={14}
                    />
                    <Text style={styles.timeLabel}>{TIMER_MODES[mode].label}</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.timerActions}>
              <AnimatedPressable
                onPress={toggleTimer}
                style={styles.primaryTimerButton}
              >
                <Ionicons
                  color={mobileTheme.colors.textOnAccent}
                  name={isRunning ? 'pause' : 'play'}
                  size={22}
                />
                <Text style={styles.primaryTimerButtonText}>
                  {isRunning
                    ? 'Pause'
                    : remainingSeconds > 0 && remainingSeconds < totalSeconds
                      ? 'Resume'
                      : 'Start'}
                </Text>
              </AnimatedPressable>

              <Pressable onPress={resetTimer} style={styles.secondaryTimerButton}>
                <Ionicons color={mobileTheme.colors.text} name="refresh" size={18} />
                <Text style={styles.secondaryTimerButtonText}>Reset</Text>
              </Pressable>
            </View>
          </SurfaceCard>
        </Animated.View>

        <Animated.View style={[styles.animatedSection, entranceStyle]}>
          <SurfaceCard style={styles.statsCard}>
            <View style={styles.cardTitleRow}>
              <Ionicons color={mobileTheme.colors.accent} name="timer-outline" size={18} />
              <Text style={styles.statsTitle}>Current app session</Text>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statBlock}>
                <Text style={styles.statValue}>{completedFocusSessions}</Text>
                <Text style={styles.statLabel}>Sessions</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.statValue}>{completedFocusMinutes}m</Text>
                <Text style={styles.statLabel}>Focused</Text>
              </View>
              <View style={styles.statBlock}>
                <Text style={styles.statValue}>{TIMER_MODES[mode].minutes}m</Text>
                <Text style={styles.statLabel}>{TIMER_MODES[mode].label}</Text>
              </View>
            </View>
          </SurfaceCard>
        </Animated.View>

        <SurfaceCard style={styles.guidanceCard}>
          <Ionicons color={mobileTheme.colors.info} name="checkmark-circle-outline" size={18} />
          <Text style={styles.guidanceText}>
            Pick one task from Tasks, start a focus session, then update the task when done.
          </Text>
        </SurfaceCard>
      </ScrollView>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  animatedSection: {
    width: '100%',
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  clockContainer: {
    alignItems: 'center',
  },
  clockFace: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 88,
    height: 176,
    justifyContent: 'center',
    width: 176,
    ...mobileTheme.shadow.fab,
  },
  clockRing: {
    alignItems: 'center',
    height: 236,
    justifyContent: 'center',
    position: 'relative',
    width: 236,
  },
  content: {
    gap: mobileTheme.spacing.md,
    paddingBottom: 110,
    paddingHorizontal: mobileTheme.spacing.lg,
    paddingTop: mobileTheme.spacing.sm,
  },
  guidanceCard: {
    alignItems: 'flex-start',
    backgroundColor: mobileTheme.colors.infoBg,
    flexDirection: 'row',
    gap: 9,
  },
  guidanceText: {
    color: mobileTheme.colors.info,
    flex: 1,
    fontSize: 13,
    fontWeight: mobileTheme.font.semibold,
    lineHeight: 19,
  },
  modeLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  primaryTimerButton: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 54,
    ...mobileTheme.shadow.fab,
  },
  primaryTimerButtonText: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 16,
    fontWeight: mobileTheme.font.black,
  },
  progressRing: {
    alignItems: 'center',
    borderColor: mobileTheme.colors.accentSoft,
    borderRadius: 112,
    borderWidth: 10,
    height: 224,
    justifyContent: 'center',
    position: 'absolute',
    width: 224,
  },
  progressText: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    position: 'absolute',
    top: 18,
  },
  pulseRing: {
    backgroundColor: mobileTheme.colors.accentSoft,
    borderRadius: 118,
    height: 236,
    position: 'absolute',
    width: 236,
  },
  secondaryTimerButton: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surfaceMuted,
    borderRadius: mobileTheme.radius.pill,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
  },
  secondaryTimerButtonText: {
    color: mobileTheme.colors.text,
    fontWeight: mobileTheme.font.bold,
  },
  sessionChip: {
    alignItems: 'center',
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.pill,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  sessionChipActive: {
    backgroundColor: mobileTheme.colors.accent,
    borderColor: mobileTheme.colors.accent,
  },
  sessionChipDisabled: {
    opacity: 0.5,
  },
  sessionChipText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
    fontWeight: mobileTheme.font.bold,
  },
  sessionChipTextActive: {
    color: mobileTheme.colors.textOnAccent,
  },
  sessionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  statBlock: {
    alignItems: 'center',
    flex: 1,
    minWidth: 76,
  },
  statLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    marginTop: 3,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  statValue: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.5,
  },
  statsCard: {
    marginTop: mobileTheme.spacing.xs,
  },
  statsRow: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
  },
  statsTitle: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
  },
  timeDisplay: {
    color: mobileTheme.colors.text,
    fontSize: 52,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -1,
  },
  timeLabel: {
    color: mobileTheme.colors.accent,
    fontSize: 11,
    fontWeight: mobileTheme.font.extrabold,
    textTransform: 'uppercase',
  },
  timerActions: {
    flexDirection: 'row',
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.xl,
    width: '100%',
  },
  timerCard: {
    alignItems: 'center',
    paddingVertical: mobileTheme.spacing.xl,
  },
});
