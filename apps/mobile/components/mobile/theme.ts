export const mobileTheme = {
  colors: {
    background: '#f3f5f8',
    surface: '#ffffff',
    surfaceMuted: '#eef2f7',
    text: '#0f172a',
    textMuted: '#64748b',
    textSubtle: '#94a3b8',
    border: '#dbe3ee',
    accent: '#1d4ed8',
    accentSoft: '#dbeafe',
    success: '#166534',
    warning: '#92400e',
    danger: '#b91c1c',
    info: '#1e40af',
    overlay: 'rgba(15, 23, 42, 0.35)',
  },
  radius: {
    card: 18,
    control: 12,
    pill: 999,
    sheet: 22,
  },
  spacing: {
    xs: 6,
    sm: 10,
    md: 14,
    lg: 18,
    xl: 24,
  },
};

export type MobileStatusTone = 'todo' | 'in_progress' | 'done' | 'blocked';
export type MobilePriorityTone = 'low' | 'medium' | 'high' | 'urgent';

export function statusTone(status: MobileStatusTone) {
  switch (status) {
    case 'done':
      return { background: '#dcfce7', color: '#166534' };
    case 'in_progress':
      return { background: '#dbeafe', color: '#1e40af' };
    case 'blocked':
      return { background: '#fee2e2', color: '#b91c1c' };
    default:
      return { background: '#e2e8f0', color: '#334155' };
  }
}

export function priorityTone(priority: MobilePriorityTone) {
  switch (priority) {
    case 'urgent':
      return { background: '#fee2e2', color: '#b91c1c' };
    case 'high':
      return { background: '#ffedd5', color: '#9a3412' };
    case 'medium':
      return { background: '#fef9c3', color: '#854d0e' };
    default:
      return { background: '#e0e7ff', color: '#3730a3' };
  }
}
