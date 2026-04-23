import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MobileScreen, MobileScreenHeader, SurfaceCard } from '@/components/mobile/primitives';
import { mobileTheme } from '@/components/mobile/theme';

export default function TimerScreen() {
  return (
    <MobileScreen>
      <MobileScreenHeader
        eyebrow="Focus"
        title="Timer"
        description="Deep work session tracker"
      />

      <View style={styles.clockContainer}>
        <View style={styles.clockRing}>
          <View style={styles.outerRing} />
          <View style={styles.innerRing} />
          <View style={styles.clockFace}>
            <Text style={styles.timeDisplay}>25:00</Text>
            <Text style={styles.timeLabel}>FOCUS</Text>
          </View>
        </View>
      </View>

      <View style={styles.sessionRow}>
        {['Focus', 'Short Break', 'Long Break'].map((label) => (
          <Pressable
            key={label}
            style={[styles.sessionChip, label === 'Focus' ? styles.sessionChipActive : null]}
          >
            <Text
              style={[
                styles.sessionChipText,
                label === 'Focus' ? styles.sessionChipTextActive : null,
              ]}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable style={styles.startButton}>
        <Ionicons name="play" size={24} color={mobileTheme.colors.textOnAccent} />
        <Text style={styles.startButtonText}>Start Session</Text>
      </Pressable>

      <SurfaceCard style={styles.statsCard}>
        <Text style={styles.statsTitle}>Today's Focus</Text>
        <View style={styles.statsRow}>
          {[
            { value: '0', label: 'Sessions' },
            { value: '0m', label: 'Focused' },
            { value: '0', label: 'Streak' },
          ].map(({ value, label }) => (
            <View key={label} style={styles.statBlock}>
              <Text style={styles.statValue}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>
      </SurfaceCard>
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  clockContainer: {
    alignItems: 'center',
    marginVertical: 36,
  },
  clockFace: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 90,
    height: 180,
    justifyContent: 'center',
    width: 180,
    ...mobileTheme.shadow.fab,
  },
  clockRing: {
    alignItems: 'center',
    height: 220,
    justifyContent: 'center',
    position: 'relative',
    width: 220,
  },
  innerRing: {
    borderColor: mobileTheme.colors.accent,
    borderRadius: 98,
    borderWidth: 4,
    height: 196,
    opacity: 0.15,
    position: 'absolute',
    width: 196,
  },
  outerRing: {
    borderColor: mobileTheme.colors.accentSoft,
    borderRadius: 110,
    borderStyle: 'dashed',
    borderWidth: 2,
    height: 220,
    position: 'absolute',
    width: 220,
  },
  sessionChip: {
    borderColor: mobileTheme.colors.border,
    borderRadius: mobileTheme.radius.pill,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sessionChipActive: {
    backgroundColor: mobileTheme.colors.accent,
    borderColor: mobileTheme.colors.accent,
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
    gap: 8,
    justifyContent: 'center',
    marginBottom: 28,
  },
  startButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 28,
    paddingHorizontal: 40,
    paddingVertical: 18,
    ...mobileTheme.shadow.fab,
  },
  startButtonText: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 17,
    fontWeight: mobileTheme.font.black,
    letterSpacing: 0.2,
  },
  statBlock: { alignItems: 'center', flex: 1 },
  statLabel: {
    color: mobileTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.3,
    marginTop: 3,
    textTransform: 'uppercase',
  },
  statValue: {
    color: mobileTheme.colors.text,
    fontSize: 24,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -0.5,
  },
  statsCard: { marginTop: 4 },
  statsRow: {
    flexDirection: 'row',
  },
  statsTitle: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: mobileTheme.font.extrabold,
    marginBottom: 14,
  },
  timeDisplay: {
    color: mobileTheme.colors.text,
    fontSize: 52,
    fontWeight: mobileTheme.font.black,
    letterSpacing: -2,
  },
  timeLabel: {
    color: mobileTheme.colors.accent,
    fontSize: 11,
    fontWeight: mobileTheme.font.extrabold,
    letterSpacing: 3,
    marginTop: 4,
  },
});
