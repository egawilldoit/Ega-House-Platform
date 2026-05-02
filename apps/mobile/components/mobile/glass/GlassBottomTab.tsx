import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { glassConfig, mobileTheme } from '../theme';

const TAB_HEIGHT = 76;
const TAB_MARGIN = 16;

function getLabel(routeName: string, options: BottomTabBarProps['descriptors'][string]['options']) {
  const label = options.tabBarLabel ?? options.title ?? routeName;

  return typeof label === 'string' ? label : routeName;
}

export function GlassBottomTab({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const useRealBlur = Platform.OS !== 'android' || glassConfig.useRealBlurOnAndroid;
  const bottomOffset = Math.max(insets.bottom, mobileTheme.spacing.sm);

  const content = (
    <>
      <LinearGradient
        colors={['rgba(255,255,255,0.82)', 'rgba(255,255,255,0.46)']}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.highlight} />
      <View style={styles.items}>
        {state.routes.map((route, index) => {
          const descriptor = descriptors[route.key];
          const options = descriptor.options;
          const focused = state.index === index;
          const color = focused ? mobileTheme.colors.accent : mobileTheme.colors.textMuted;
          const label = getLabel(route.name, options);

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              key={route.key}
              onLongPress={onLongPress}
              onPress={onPress}
              style={({ pressed }) => [
                styles.item,
                focused ? styles.itemActive : null,
                pressed ? styles.itemPressed : null,
              ]}
            >
              {options.tabBarIcon
                ? options.tabBarIcon({ focused, color, size: focused ? 22 : 21 })
                : null}
              <Text numberOfLines={1} style={[styles.label, focused ? styles.labelActive : null]}>
                {label}
              </Text>
              {focused ? <View style={styles.activeDot} /> : null}
            </Pressable>
          );
        })}
      </View>
    </>
  );

  const wrapperStyle = {
    height: TAB_HEIGHT + bottomOffset + mobileTheme.spacing.sm,
  };
  const tabStyle = [
    styles.container,
    { bottom: bottomOffset, height: TAB_HEIGHT, left: TAB_MARGIN, right: TAB_MARGIN },
  ];

  if (useRealBlur) {
    return (
      <View pointerEvents="box-none" style={wrapperStyle}>
        <BlurView intensity={mobileTheme.glass.blurIntensity.medium} tint="light" style={tabStyle}>
          {content}
        </BlurView>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={wrapperStyle}>
      <View style={[tabStyle, styles.fake]}>{content}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  activeDot: {
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: mobileTheme.radius.pill,
    bottom: 7,
    height: 4,
    position: 'absolute',
    width: 4,
  },
  container: {
    backgroundColor: mobileTheme.glass.surface,
    borderColor: mobileTheme.glass.border,
    borderRadius: 38,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'absolute',
    ...mobileTheme.glass.shadow,
  },
  fake: {
    backgroundColor: mobileTheme.glass.surfaceStrong,
  },
  highlight: {
    borderColor: mobileTheme.glass.highlight,
    borderRadius: 37,
    borderTopWidth: 1,
    left: 1,
    opacity: 0.85,
    position: 'absolute',
    right: 1,
    top: 1,
  },
  item: {
    alignItems: 'center',
    borderRadius: mobileTheme.radius.pill,
    flex: 1,
    gap: 2,
    height: 60,
    justifyContent: 'center',
    position: 'relative',
  },
  itemActive: {
    backgroundColor: 'rgba(255,255,255,0.72)',
    ...mobileTheme.shadow.control,
  },
  itemPressed: {
    opacity: 0.76,
  },
  items: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    height: '100%',
    paddingHorizontal: 8,
    position: 'relative',
    zIndex: 2,
  },
  label: {
    color: mobileTheme.colors.textMuted,
    fontSize: 10,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0.2,
  },
  labelActive: {
    color: mobileTheme.colors.accent,
    fontWeight: mobileTheme.font.extrabold,
  },
});
