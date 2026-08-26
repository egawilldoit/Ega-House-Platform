/**
 * Mobile design tokens — Wave 10.2 expressive tonal system
 * Single authority for apps/mobile. Stitch tokens map INTO this file.
 *
 * Tonal direction (spec 39-43, not immutable):
 *   Canvas #F7F8FC, Surface #FFFFFF, Surface Low #F3F6FB, Surface Mid #EDF2F8, Surface High #E6ECF5
 *   Primary #2563EB On Primary #FFFFFF Primary Container #DBEAFE On Primary Container #1D4ED8
 *   Secondary indigo #5B21B6 Secondary Container #EDE9FE On Secondary Container #5B21B6
 *   Tertiary warm amber #B45309 Tertiary Container #FEF3C7 On Tertiary Container #92400E
 *   Success #166534 Success Container #DCFCE7
 *   Danger #991B1B Danger Container #FEE2E2
 *   Neutral #475569 Neutral Container #F1F5F9
 *
 * Color occupancy: large surfaces stay neutral (canvas/surface/surfaceLow). Accent containers
 * only for active / key actions / hero. Do NOT color every card.
 *
 * Contrast — WCAG AA small text >=4.5 (11px bold chips, filter pills, placeholders, danger/warning/success):
 *   All ratios computed via relative luminance (WCAG 2.1):
 *     luminance(c)=0.2126*lin(R)+0.7152*lin(G)+0.0722*lin(B), lin(c)=c/12.92 if c<=0.04045 else ((c+0.055)/1.055)^2.4
 *     contrast=(Llighter+0.05)/(Ldarker+0.05)
 *   Verified pairs (manual calc, see python contrast script):
 *     #1D4ED8 on #DBEAFE (primaryContainer) 5.49 PASS — replaces #2563eb on DBEAFE 4.24 FAIL
 *     #5B21B6 on #EDE9FE (secondaryContainer) 7.57 PASS
 *     #92400E on #FEF3C7 (tertiaryContainer) 6.37 PASS — #B45309 on FEF3C7 4.51 borderline
 *     #166534 on #DCFCE7 (successContainer) 6.49 PASS — #15803d on DCFCE7 4.57 PASS (keep darker)
 *     #991B1B on #FEE2E2 (dangerContainer) 6.80 PASS — #dc2626 on FEE2E2 3.95 FAIL
 *     #475569 on #F1F5F9 (neutralContainer) 6.92 PASS — #64748b on F1F5F9 4.34 FAIL
 *     #c2410c on #ffedd5 (high) 4.52 PASS
 *     #92400E on #fef9c3 (medium/paused) 6.60 PASS
 *     #166534 on #f0fdf4 (low) 6.81 PASS
 *     #666b71 (textSubtle/placeholder) on #FFFFFF 5.38 PASS, on #F7F8FC 5.07 PASS, on #F3F6FB 4.96 PASS, on #EDF2F8 4.78 PASS, on #E6ECF5 4.53 PASS, on #F1F5F9 4.91 PASS
 *     #6b7280 (textMuted) on #FFFFFF 4.83 PASS, on #F7F8FC 4.56 PASS, on #F3F6FB 4.46 FAIL — use textSubtle on tonal surfaces
 *     #0d1117 (text) on canvas #F7F8FC 17.83 PASS, on surfaceLow #F3F6FB 17.47 PASS, on surfaceHigh #E6ECF5 15.93 PASS
 *     #FFFFFF on #2563eb 5.17 PASS, on #5B21B6 8.98 PASS, on #991B1B 8.31 PASS
 *   Chip archived now uses neutral #475569 (was #64748b fail). Danger chips use #991B1B (was #dc2626 fail).
 *   Warning/tertiary chips use on-container #92400E for small text (not #B45309).
 *
 * Spacing — 4-pt rhythm 4/8/12/16/20/24/32: md 14→12 compact, xl 28→24, xxl 36→32. lg 20 stays (page padding).
 */
export const mobileTheme = {
  colors: {
    // Canvas & surfaces — tonal ladder
    canvas: '#F7F8FC',
    background: '#F7F8FC', // alias canvas for compat
    backgroundDeep: '#E6ECF5', // was #e9edf3 → align to surfaceHigh
    surface: '#ffffff',
    surfaceLow: '#F3F6FB',
    surfaceMid: '#EDF2F8',
    surfaceHigh: '#E6ECF5',
    // compat aliases (do not use for new tonal variants)
    surfaceMuted: '#F3F6FB', // alias surfaceLow
    surfaceElevated: '#ffffff', // alias surface

    // Text
    text: '#0d1117',
    textSecondary: '#374151',
    textMuted: '#6b7280', // AA on surface/canvas only; on tonal use textSubtle
    // AA-checked on all surfaces including tonal (>=4.5).
    textSubtle: '#666b71',
    textOnAccent: '#ffffff',
    placeholder: '#666b71', // alias textSubtle — use for Input placeholder

    // Borders
    border: '#e4e7ec',
    borderStrong: '#cfd5df',

    // Brand — primary expressive
    primary: '#2563eb',
    onPrimary: '#ffffff',
    primaryContainer: '#DBEAFE',
    onPrimaryContainer: '#1d4ed8',
    accent: '#2563eb', // alias primary
    accentDark: '#1d4ed8', // alias onPrimaryContainer
    accentSoft: '#DBEAFE', // alias primaryContainer
    accentMid: '#93c5fd',

    // Secondary — indigo expressive
    secondary: '#5b21b6',
    secondaryContainer: '#ede9fe',
    onSecondaryContainer: '#5b21b6',

    // Tertiary — warm amber expressive
    tertiary: '#b45309',
    tertiaryContainer: '#fef3c7',
    onTertiaryContainer: '#92400e',

    // Semantic — success (darker foreground for AA)
    success: '#166534',
    successContainer: '#dcfce7',
    onSuccessContainer: '#166534',
    successBg: '#dcfce7', // alias
    successMid: '#86efac',

    warning: '#b45309',
    warningContainer: '#fef3c7',
    onWarningContainer: '#92400e',
    warningBg: '#fef3c7', // alias
    warningMid: '#fcd34d',

    danger: '#991b1b',
    dangerContainer: '#fee2e2',
    onDangerContainer: '#991b1b',
    dangerBg: '#fee2e2', // alias
    dangerMid: '#fca5a5',
    dangerBorder: '#991b1b', // was #b91c1c — now aligns to danger 6.80 ratio

    info: '#1d4ed8',
    infoBg: '#dbeafe',
    infoContainer: '#dbeafe',
    onInfoContainer: '#1d4ed8',
    infoMid: '#93c5fd',

    // Status-specific (blocked maps to danger)
    blocked: '#991b1b',
    blockedBg: '#fee2e2',
    blockedContainer: '#fee2e2',
    onBlockedContainer: '#991b1b',

    // Overlay
    overlay: 'rgba(10, 15, 30, 0.45)',
    overlayLight: 'rgba(10, 15, 30, 0.12)',

    // Neutral — slate / status neutral
    neutral: '#475569',
    neutralContainer: '#f1f5f9',
    onNeutralContainer: '#475569',
    slate: '#475569', // alias neutral
    slateBg: '#f1f5f9', // alias neutralContainer
    neutralBg: '#f1f5f9', // alias
    neutralMid: '#94a3b8',
    neutralStrong: '#475569', // alias neutral

    highBg: '#ffedd5',
    high: '#c2410c',
    highContainer: '#ffedd5',
    onHighContainer: '#c2410c',
    highMid: '#f97316',
    lowBg: '#f0fdf4',
    low: '#166534',
    lowContainer: '#f0fdf4',
    onLowContainer: '#166534',
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
    card: 20, // future 16 per H-5, keep 20 until 10.3 primitives
    control: 12,
    pill: 999,
    sheet: 28,
  },

  spacing: {
    xs: 4,
    sm: 8,
    md: 12, // was 14 → 12 compact rhythm 4/8/12/16/20/24/32
    lg: 20,
    xl: 24, // was 28 → 24 rhythm
    xxl: 32, // was 36 → 32 rhythm
  },

  layout: {
    floatingTabClearance: 160, // fallback token; runtime authoritative geometry in navigation/bottomChrome.ts
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

export type MobileStatusTone =
  | 'todo'
  | 'planned'
  | 'in_progress'
  | 'active'
  | 'done'
  | 'blocked'
  | 'paused'
  | 'archived'
  | 'draft';
export type MobilePriorityTone = 'low' | 'medium' | 'high' | 'urgent';
export type MobileHealthTone = 'on_track' | 'at_risk' | 'off_track' | null;

export type ChipTone = { background: string; color: string; dot: string };
export type ChipKind = 'status' | 'priority' | 'health';

export function statusTone(status: MobileStatusTone): ChipTone {
  switch (status) {
    case 'done':
      return { background: '#dcfce7', color: '#166534', dot: '#22c55e' };
    case 'in_progress':
      return { background: '#fef3c7', color: '#92400e', dot: '#f59e0b' };
    case 'active':
      return { background: '#dbeafe', color: '#1d4ed8', dot: '#3b82f6' };
    case 'blocked':
      return { background: '#fee2e2', color: '#991b1b', dot: '#ef4444' };
    case 'paused':
      return { background: '#fef9c3', color: '#92400e', dot: '#eab308' };
    case 'archived':
      return { background: '#f1f5f9', color: '#475569', dot: '#94a3b8' };
    case 'planned':
    case 'draft':
    case 'todo':
    default:
      return { background: '#f1f5f9', color: '#475569', dot: '#94a3b8' };
  }
}

export function priorityTone(priority: MobilePriorityTone): ChipTone {
  switch (priority) {
    case 'urgent':
      return { background: '#fee2e2', color: '#991b1b', dot: '#ef4444' };
    case 'high':
      return { background: '#ffedd5', color: '#c2410c', dot: '#f97316' };
    case 'medium':
      return { background: '#fef9c3', color: '#92400e', dot: '#eab308' };
    default:
      return { background: '#f0fdf4', color: '#166534', dot: '#4ade80' };
  }
}

export function healthTone(health: MobileHealthTone): ChipTone {
  switch (health) {
    case 'on_track':
      return { background: '#dcfce7', color: '#166534', dot: '#22c55e' };
    case 'at_risk':
      return { background: '#fef9c3', color: '#92400e', dot: '#eab308' };
    case 'off_track':
      return { background: '#fee2e2', color: '#991b1b', dot: '#ef4444' };
    default:
      return { background: '#f1f5f9', color: '#475569', dot: '#94a3b8' };
  }
}

export function chipTone(kind: ChipKind, value: string | null): ChipTone {
  if (kind === 'priority') {
    return priorityTone((value as MobilePriorityTone) ?? 'low');
  }
  if (kind === 'health') {
    return healthTone((value as MobileHealthTone) ?? null);
  }
  return statusTone((value as MobileStatusTone) ?? 'todo');
}

// Legacy project/goal helpers now delegate to central resolver
export function projectStatusTone(status: string): ChipTone {
  return statusTone(status as MobileStatusTone);
}

export function goalHealthTone(health: string | null): ChipTone {
  return healthTone(health as MobileHealthTone);
}

export function goalStatusTone(status: string): ChipTone {
  return statusTone(status as MobileStatusTone);
}

// Dev utility — contrast validation (WCAG 2.1)
// Exported for manual verification; not used at runtime.
// Example: contrastRatio('#991b1b','#fee2e2') === 6.80
export function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrastRatio(fg: string, bg: string): number {
  const L1 = luminance(fg);
  const L2 = luminance(bg);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}
