export const colors = {
  bg: '#FFFBF5',
  surface: '#FFFFFF',
  surfaceMuted: '#FFF8F0',
  border: '#E8E0D4',
  borderSoft: 'rgba(199, 191, 179, 0.4)',
  text: '#2D2926',
  textMuted: '#736C62',
  textSoft: '#9C958A',
  gold: '#F5A623',
  goldDeep: '#DE911D',
  hot: '#FF6B35',
  active: '#4CAF50',
  info: '#42A5F5',
  error: '#E53935',
  success: '#16A34A',
} as const;

export const shadows = {
  card: '0 18px 48px rgba(112, 93, 72, 0.12), 0 4px 12px rgba(0, 0, 0, 0.05)',
  float: '0 26px 70px rgba(112, 93, 72, 0.16), 0 8px 18px rgba(0, 0, 0, 0.08)',
  tab: '0 20px 42px rgba(77, 64, 47, 0.18), 0 8px 18px rgba(0, 0, 0, 0.08)',
} as const;

export const breakpoints = {
  mobile: 768,
  panel: 1024,
} as const;
