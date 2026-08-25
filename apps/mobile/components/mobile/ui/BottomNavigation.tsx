import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { glassConfig, mobileTheme } from '@/components/mobile/theme';

const TAB_HEIGHT = 72;
const TAB_MARGIN = 24;
const PILL_BOTTOM_GAP = 20;
const TAB_LABEL_MAX_FONT_SCALE = 1.4;

function getLabel(routeName: string, options: BottomTabBarProps['descriptors'][string]['options']) {
  const label = options.tabBarLabel ?? options.title ?? routeName;
  return typeof label === 'string' ? label : routeName;
}

function isHiddenRoute(descriptor: BottomTabBarProps['descriptors'][string]) {
  return (descriptor.options as { href?: unknown }).href === null;
}

export function BottomNavigation({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const useRealBlur = Platform.OS !== 'android' || glassConfig.useRealBlurOnAndroid;
  const bottomOffset = Math.max(insets.bottom, 12) + PILL_BOTTOM_GAP;
  const pillWidth = Math.max(Math.min(width - TAB_MARGIN * 2, 560), 280);

  const visibleRoutes = state.routes.filter((route) => !isHiddenRoute(descriptors[route.key]));

  const content = (
    <>
      <LinearGradient
        colors={['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.01)']}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.highlight} />
      <View style={styles.items}>
        {visibleRoutes.map((route) => {
          const descriptor = descriptors[route.key];
          const options = descriptor.options;
          const index = state.routes.findIndex((r) => r.key === route.key);
          const focused = state.index === index;
          const color = focused ? mobileTheme.nav.active : 'rgba(255,255,255,0.62)';
          const label = getLabel(route.name, options);

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              (navigation.navigate as unknown as (name: string, params?: object) => void)(
                route.name,
                route.params as object | undefined,
              );
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
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              style={({ pressed }) => [styles.item, pressed ? styles.itemPressed : null]}
            >
              {options.tabBarIcon ? options.tabBarIcon({ focused, color, size: focused ? 23 : 21 }) : null}
              <Text maxFontSizeMultiplier={TAB_LABEL_MAX_FONT_SCALE} numberOfLines={1} style={[styles.label, focused ? styles.labelActive : null]}>
                {label}
              </Text>
              {focused ? <View style={styles.activeDot} /> : null}
            </Pressable>
          );
        })}
      </View>
    </>
  );

  const wrapperStyle = [styles.wrapper, { bottom: bottomOffset }];

  if (useRealBlur) {
    return (
      <View pointerEvents="box-none" style={wrapperStyle}>
        <LinearGradient colors={['rgba(246,247,249,0)', 'rgba(246,247,249,0.86)']} pointerEvents="none" style={styles.navFade} />
        <BlurView intensity={mobileTheme.glass.blurIntensity.medium} tint="dark" style={[styles.container, { width: pillWidth }]}>
          {content}
        </BlurView>
      </View>
    );
  }

  return (
    <View pointerEvents="box-none" style={wrapperStyle}>
      <LinearGradient colors={['rgba(246,247,249,0)', 'rgba(246,247,249,0.86)']} pointerEvents="none" style={styles.navFade} />
      <View style={[styles.container, styles.fake, { width: pillWidth }]}>{content}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  activeDot: {
    backgroundColor: mobileTheme.nav.dot,
    borderRadius: mobileTheme.radius.pill,
    bottom: 6,
    height: 4,
    position: 'absolute',
    width: 16,
  },
  container: {
    backgroundColor: mobileTheme.nav.shellBackground,
    borderColor: mobileTheme.nav.shellBorder,
    borderRadius: mobileTheme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: TAB_HEIGHT,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 10,
    zIndex: 1,
  },
  fake: {
    backgroundColor: mobileTheme.nav.shellBackground,
  },
  highlight: {
    borderColor: mobileTheme.nav.shellBorder,
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
    gap: 3,
    justifyContent: 'center',
    minHeight: mobileTheme.layout.minTouchTarget,
    position: 'relative',
  },
  itemPressed: {
    opacity: 0.76,
  },
  items: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    height: '100%',
    paddingHorizontal: 8,
    position: 'relative',
    zIndex: 2,
  },
  label: {
    color: mobileTheme.nav.inactiveText,
    fontSize: 10,
    fontWeight: mobileTheme.font.bold,
    letterSpacing: 0,
  },
  labelActive: {
    color: mobileTheme.nav.activeText,
    fontWeight: mobileTheme.font.extrabold,
  },
  navFade: {
    bottom: TAB_HEIGHT - 10,
    height: 62,
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 0,
  },
  wrapper: {
    alignItems: 'center',
    backgroundColor: 'transparent',
    left: 0,
    position: 'absolute',
    right: 0,
  },
});
