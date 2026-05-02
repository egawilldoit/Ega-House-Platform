export const mobileTheme = {
  colors: {
    // Backgrounds
    background: '#f6f7f9',
    backgroundDeep: '#e9edf3',
    surface: '#ffffff',
    surfaceMuted: '#f2f4f7',
    surfaceElevated: '#ffffff',

    // Text
    text: '#0d1117',
    textSecondary: '#374151',
    textMuted: '#6b7280',
    textSubtle: '#9ca3af',
    textOnAccent: '#ffffff',

    // Borders
    border: '#e4e7ec',
    borderStrong: '#cfd5df',

    // Brand accent
    primary: '#2563eb',
    accent: '#2563eb',
    accentDark: '#1d4ed8',
    accentSoft: '#dbeafe',
    accentMid: '#93c5fd',

    // Semantic
    success: '#15803d',
    successBg: '#dcfce7',
    successMid: '#86efac',

    warning: '#b45309',
    warningBg: '#fef3c7',
    warningMid: '#fcd34d',

    danger: '#dc2626',
    dangerBg: '#fee2e2',
    dangerMid: '#fca5a5',

    info: '#1d4ed8',
    infoBg: '#dbeafe',
    infoMid: '#93c5fd',

    // Status-specific
    blocked: '#7c3aed',
    blockedBg: '#ede9fe',

    // Overlay
    overlay: 'rgba(10, 15, 30, 0.45)',
    overlayLight: 'rgba(10, 15, 30, 0.12)',

    // Additional utility tones for mobile-only UI affordances
    slate: '#475569',
    slateBg: '#f1f5f9',
    neutralBg: '#f1f5f9',
    neutralMid: '#94a3b8',
    neutralStrong: '#475569',
    highBg: '#ffedd5',
    high: '#c2410c',
    highMid: '#f97316',
    lowBg: '#f0fdf4',
    low: '#166534',
    lowMid: '#4ade80',
    accentBarEnd: '#60a5fa',
    authBackground: '#0d1117',
    authSurface: '#161c28',
    authSurfaceMuted: 'rgba(255,255,255,0.07)',
    authBorder: 'rgba(255,255,255,0.12)',
    authBorderSoft: 'rgba(255,255,255,0.08)',
    authTextMuted: 'rgba(255,255,255,0.55)',
    authTextSubtle: 'rgba(255,255,255,0.35)',
    authCircleBlue: 'rgba(37,99,235,0.18)',
    authCirclePurple: 'rgba(124,58,237,0.12)',
    tabBarBgIos: '#050505',
    tabBarBgAndroid: '#050505',
    stickyBar: 'rgba(243,245,248,0.97)',
    skeleton: '#e8edf4',
  },

  radius: {
    xs: 6,
    sm: 10,
    md: 14,
    lg: 18,
    xl: 22,
    card: 20,
    control: 12,
    pill: 999,
    sheet: 28,
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 14,
    lg: 20,
    xl: 28,
    xxl: 36,
  },

  layout: {
    floatingTabClearance: 160,
    stickyActionClearance: 120,
    minTouchTarget: 44,
  },

  shadow: {
    card: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.04,
      shadowRadius: 7,
      elevation: 1,
    },
    cardHover: {
      shadowColor: '#1a2540',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.08,
      shadowRadius: 10,
      elevation: 3,
    },
    control: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
    },
    fab: {
      shadowColor: '#2563eb',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.22,
      shadowRadius: 10,
      elevation: 5,
    },
    sheet: {
      shadowColor: '#0d1117',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.12,
      shadowRadius: 24,
      elevation: 12,
    },
  },

  glass: {
    surface: '#ffffff',
    surfaceStrong: '#ffffff',
    border: 'rgba(208,213,221,0.9)',
    highlight: 'rgba(255,255,255,0.65)',
    fakeBackground: '#ffffff',
    blurIntensity: {
      soft: 24,
      medium: 35,
      strong: 45,
    },
    shadow: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.045,
      shadowRadius: 7,
      elevation: 1,
    },
  },

  nav: {
    shellBackground: 'rgba(20,20,20,0.85)',
    shellBorder: 'rgba(255,255,255,0.10)',
    active: '#2563eb',
    activeBackground: 'transparent',
    activeText: '#ffffff',
    inactiveText: 'rgba(255,255,255,0.60)',
    dot: '#2563eb',
  },

  font: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    extrabold: '800' as const,
    black: '900' as const,
  },
};

export const glassConfig = {
  useRealBlurOnAndroid: false,
  useRealBlurForLists: false,
};

export type MobileStatusTone = 'todo' | 'in_progress' | 'done' | 'blocked';
export type MobilePriorityTone = 'low' | 'medium' | 'high' | 'urgent';

export function statusTone(status: MobileStatusTone) {
  switch (status) {
    case 'done':
      return { background: '#dcfce7', color: '#15803d', dot: '#22c55e' };
    case 'in_progress':
      return { background: '#dbeafe', color: '#1d4ed8', dot: '#3b82f6' };
    case 'blocked':
      return { background: '#ede9fe', color: '#7c3aed', dot: '#8b5cf6' };
    default:
      return { background: '#f1f5f9', color: '#475569', dot: '#94a3b8' };
  }
}

export function priorityTone(priority: MobilePriorityTone) {
  switch (priority) {
    case 'urgent':
      return { background: '#fee2e2', color: '#dc2626', dot: '#ef4444' };
    case 'high':
      return { background: '#ffedd5', color: '#c2410c', dot: '#f97316' };
    case 'medium':
      return { background: '#fef9c3', color: '#92400e', dot: '#eab308' };
    default:
      return { background: '#f0fdf4', color: '#166534', dot: '#4ade80' };
  }
}
