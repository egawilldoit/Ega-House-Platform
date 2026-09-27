import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { isValidIANATimeZone } from '@ega/domain/time-context';

import { fetchMobileTimeContext, setMobileTimezone } from '@/lib/api/time-context';
import { mobileTheme } from '@/components/mobile/theme';
import { AppScreen } from '@/components/mobile/ui/AppScreen';
import { Button } from '@/components/mobile/ui/Button';
import { Card } from '@/components/mobile/ui/Card';
import { FormField } from '@/components/mobile/ui/FormField';
import { ScreenHeader } from '@/components/mobile/ui/ScreenHeader';

const COMMON_TIMEZONES = [
  'UTC',
  'Africa/Casablanca',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tokyo',
  'Europe/Paris',
];

function detectDeviceTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidIANATimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

export default function TimezoneSettingsScreen() {
  const [timeContext, setTimeContext] = useState<Awaited<ReturnType<typeof fetchMobileTimeContext>> | null>(null);
  // Detected once per mount: the device zone is stable for the session.
  const [deviceTimezone] = useState<string | null>(() => detectDeviceTimezone());
  const [manualTimezone, setManualTimezone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchMobileTimeContext()
      .then((result) => {
        setTimeContext(result);
        setError(null);
      })
      .catch(() => {
        setError('Could not load your timezone right now.');
      });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const effectiveTimezone = timeContext?.timeContext?.timezone ?? 'UTC';
  const fallback = timeContext?.timeContext?.fallback ?? 'none';
  const deviceDiffers =
    deviceTimezone !== null &&
    deviceTimezone !== effectiveTimezone &&
    fallback === 'none';

  const applyTimezone = useCallback(
    async (timezone: string) => {
      setSaving(true);
      setError(null);
      try {
        await setMobileTimezone(timezone);
        await load();
      } catch {
        setError('Could not save that timezone. Check the name and try again.');
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  const onManualSubmit = useCallback(() => {
    const trimmed = manualTimezone.trim();
    if (!trimmed) return;
    if (!isValidIANATimeZone(trimmed)) {
      setError(`"${trimmed}" is not a valid IANA timezone.`);
      return;
    }
    setManualTimezone('');
    void applyTimezone(trimmed);
  }, [applyTimezone, manualTimezone]);

  return (
    <AppScreen padded={false} testID="timezone-settings-screen">
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScreenHeader
          eyebrow="Settings"
          title="Timezone"
          description="Used for Today, Tasks, Timer, reminders, analytics and reviews."
        />

        {error ? (
          <Text style={styles.error} testID="timezone-error">
            {error}
          </Text>
        ) : null}

        {!timeContext ? (
          <View style={styles.centered}>
            <ActivityIndicator color={mobileTheme.colors.accent} />
            <Text style={styles.subtitle}>Loading timezone…</Text>
          </View>
        ) : (
          <>
            <Card style={styles.card}>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <View style={styles.rowTitleRow}>
                    <Ionicons name="time-outline" size={16} color={mobileTheme.colors.textMuted} />
                    <Text style={styles.rowTitle}>EGA House timezone</Text>
                  </View>
                  <Text style={styles.rowValue} testID="ega-timezone-value">
                    {effectiveTimezone}
                  </Text>
                  {fallback !== 'none' ? (
                    <Text style={styles.rowHint}>
                      {fallback === 'missing_timezone'
                        ? 'No timezone saved yet — features fall back to UTC.'
                        : 'Saved timezone is invalid — features fall back to UTC.'}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Card>

            <Card style={styles.card}>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <View style={styles.rowTitleRow}>
                    <Ionicons name="phone-portrait-outline" size={16} color={mobileTheme.colors.textMuted} />
                    <Text style={styles.rowTitle}>Device timezone</Text>
                  </View>
                  <Text style={styles.rowValue}>{deviceTimezone ?? 'Unavailable'}</Text>
                </View>
                {deviceDiffers ? (
                  <Button
                    title="Use device timezone"
                    variant="secondary"
                    size="sm"
                    leftIcon={<Ionicons color={mobileTheme.colors.textOnAccent} name="swap-horizontal-outline" size={14} />}
                    onPress={() => void applyTimezone(deviceTimezone ?? 'UTC')}
                    disabled={saving}
                    testID="use-device-timezone"
                  />
                ) : null}
              </View>
            </Card>

            <Card style={styles.card}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Set timezone manually</Text>
                <Text style={styles.rowHint}>Enter any IANA timezone name.</Text>
                <View style={styles.manualRow}>
                  <View style={styles.manualInput}>
                    <FormField
                      value={manualTimezone}
                      onChangeText={setManualTimezone}
                      placeholder="e.g. Africa/Casablanca"
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="done"
                      onSubmitEditing={onManualSubmit}
                      testID="timezone-manual-input"
                    />
                  </View>
                  <Button
                    title="Set"
                    variant="primary"
                    size="sm"
                    onPress={onManualSubmit}
                    disabled={saving || !manualTimezone.trim()}
                    testID="timezone-manual-submit"
                  />
                </View>
              </View>
            </Card>

            <Card style={styles.card}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Quick picks</Text>
                <View style={styles.chipWrap}>
                  {COMMON_TIMEZONES.map((zone) => (
                    <Pressable
                      key={zone}
                      onPress={() => void applyTimezone(zone)}
                      disabled={saving}
                      style={({ pressed }: { pressed: boolean }) => [
                        styles.chip,
                        zone === effectiveTimezone ? styles.chipActive : null,
                        pressed ? styles.pressed : null,
                      ]}
                      testID={`timezone-quick-${zone}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Set timezone to ${zone}`}
                    >
                      <Text style={[styles.chipText, zone === effectiveTimezone ? styles.chipTextActive : null]}>
                        {zone}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </Card>
          </>
        )}
      </ScrollView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  centered: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
  },
  subtitle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 14,
  },
  error: {
    color: mobileTheme.colors.danger,
    fontSize: 14,
    paddingHorizontal: 4,
  },
  card: {
    padding: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowTitle: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
  },
  rowValue: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  rowHint: {
    color: mobileTheme.colors.textSubtle,
    fontSize: 12,
    marginTop: 4,
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  manualInput: {
    flex: 1,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: mobileTheme.colors.surfaceLow,
  },
  chipActive: {
    backgroundColor: mobileTheme.colors.accent,
  },
  chipText: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
  },
  chipTextActive: {
    color: mobileTheme.colors.textOnAccent,
  },
  pressed: {
    opacity: 0.7,
  },
});
