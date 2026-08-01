export type ThemeMode = 'light' | 'dark' | 'system';

export type ThemeAccent = 'emerald' | 'blue' | 'pink' | 'violet' | 'amber' | 'cyan';

export interface ThemeAccentPreset {
  label: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  accentTint: string;
  accentText: string;
  accentLine: string;
  accentGlow: string;
  accentGlowStrong: string;
}

export const THEME_ACCENTS: Record<ThemeAccent, ThemeAccentPreset> = {
  emerald: {
    label: '青绿',
    accent: '#0f766e',
    accentHover: '#115e59',
    accentSoft: '#ccfbf1',
    accentTint: '#f0fdfa',
    accentText: '#0f766e',
    accentLine: 'rgba(45, 212, 191, 0.48)',
    accentGlow: 'rgba(20, 184, 166, 0.18)',
    accentGlowStrong: 'rgba(15, 118, 110, 0.30)',
  },
  blue: {
    label: '星蓝',
    accent: '#2563eb',
    accentHover: '#1d4ed8',
    accentSoft: '#dbeafe',
    accentTint: '#eff6ff',
    accentText: '#1d4ed8',
    accentLine: 'rgba(96, 165, 250, 0.52)',
    accentGlow: 'rgba(37, 99, 235, 0.18)',
    accentGlowStrong: 'rgba(29, 78, 216, 0.30)',
  },
  pink: {
    label: '玫粉',
    accent: '#db2777',
    accentHover: '#be185d',
    accentSoft: '#fce7f3',
    accentTint: '#fdf2f8',
    accentText: '#be185d',
    accentLine: 'rgba(244, 114, 182, 0.52)',
    accentGlow: 'rgba(219, 39, 119, 0.17)',
    accentGlowStrong: 'rgba(190, 24, 93, 0.29)',
  },
  violet: {
    label: '曜紫',
    accent: '#7c3aed',
    accentHover: '#6d28d9',
    accentSoft: '#ede9fe',
    accentTint: '#f5f3ff',
    accentText: '#6d28d9',
    accentLine: 'rgba(167, 139, 250, 0.52)',
    accentGlow: 'rgba(124, 58, 237, 0.17)',
    accentGlowStrong: 'rgba(109, 40, 217, 0.28)',
  },
  amber: {
    label: '琥珀',
    accent: '#d97706',
    accentHover: '#b45309',
    accentSoft: '#fef3c7',
    accentTint: '#fffbeb',
    accentText: '#b45309',
    accentLine: 'rgba(251, 191, 36, 0.55)',
    accentGlow: 'rgba(217, 119, 6, 0.16)',
    accentGlowStrong: 'rgba(180, 83, 9, 0.27)',
  },
  cyan: {
    label: '冰青',
    accent: '#0891b2',
    accentHover: '#0e7490',
    accentSoft: '#cffafe',
    accentTint: '#ecfeff',
    accentText: '#0e7490',
    accentLine: 'rgba(34, 211, 238, 0.50)',
    accentGlow: 'rgba(8, 145, 178, 0.17)',
    accentGlowStrong: 'rgba(14, 116, 144, 0.28)',
  },
};

export function isThemeAccent(value: string | null): value is ThemeAccent {
  return Boolean(value && value in THEME_ACCENTS);
}
