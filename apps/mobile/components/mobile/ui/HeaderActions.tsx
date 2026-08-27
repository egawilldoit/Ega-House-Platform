import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/lib/auth/auth-context';

import { IconButton } from './IconButton';
import { mobileTheme } from '@/components/mobile/theme';
import { Pressable, Text } from 'react-native';

export type HeaderActionsProps = {
  showSearch?: boolean;
  showAvatar?: boolean;
  onSearchPress?: () => void;
};

function getInitials(email: string | undefined) {
  if (!email) return 'EG';
  return email.substring(0, 2).toUpperCase();
}

export function HeaderActions({ showSearch = true, showAvatar = true, onSearchPress }: HeaderActionsProps) {
  const router = useRouter();
  const { user } = useAuth();
  const initials = getInitials(user?.email);

  return (
    <View style={styles.row}>
      {showSearch ? (
        <IconButton
          accessibilityLabel="Search"
          icon="search"
          onPress={() => {
            if (onSearchPress) {
              onSearchPress();
              return;
            }
            router.push('/(app)/search');
          }}
          size={44}
          variant="secondary"
        />
      ) : null}
      {showAvatar ? (
        <Pressable
          accessibilityLabel="Open profile"
          accessibilityRole="button"
          onPress={() => router.push('/(app)/profile')}
          style={({ pressed }) => [styles.avatarPressable, pressed ? styles.pressed : null]}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  avatarPressable: {
    alignItems: 'center',
    height: mobileTheme.layout.minTouchTarget,
    justifyContent: 'center',
    width: mobileTheme.layout.minTouchTarget,
  },
  avatarText: {
    color: mobileTheme.colors.textOnAccent,
    fontSize: 13,
    fontWeight: mobileTheme.font.black,
  },
  pressed: {
    opacity: 0.7,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
});
