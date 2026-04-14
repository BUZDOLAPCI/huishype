/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand gold (replaces blue primary)
        primary: {
          50: '#FFFBEB',
          100: '#FFF3C4',
          200: '#FCE588',
          300: '#FADB5F',
          400: '#F7C948',
          500: '#F5A623',
          600: '#DE911D',
          700: '#B47712',
          800: '#8C5E0A',
          900: '#6B4706',
        },
        // Warm neutrals (replaces cool-gray)
        warm: {
          50: '#FFFBF5',
          100: '#FFF8F0',
          200: '#F5F0E8',
          300: '#E8E0D4',
          400: '#C7BFB3',
          500: '#9C958A',
          600: '#736C62',
          700: '#504A42',
          800: '#3D3832',
          900: '#2D2926',
        },
        // Surface colors
        surface: {
          DEFAULT: '#FFFBF5',
          card: '#FFFFFF',
          elevated: '#FFFFFF',
          input: '#FFF8F0',
          muted: '#F5F0E8',
        },
        // Semantic colors
        'crowd-green': {
          50: '#ECFDF5',
          100: '#D1FAE5',
          500: '#4CAF50',
          700: '#15803D',
        },
        'error-red': {
          50: '#FFEBEE',
          100: '#FFCDD2',
          500: '#E53935',
          700: '#C62828',
        },
        'hot-red': {
          50: '#FFF5F0',
          100: '#FFE0D6',
          500: '#FF6B35',
          700: '#C43E00',
        },
        'info-blue': {
          50: '#E3F2FD',
          100: '#BBDEFB',
          500: '#42A5F5',
          700: '#1565C0',
        },
        'warning-orange': {
          50: '#FFF8E1',
          100: '#FFECB3',
          500: '#FF9500',
          700: '#B45309',
        },
      },
      fontFamily: {
        // Inter (primary UI font)
        sans: ['Inter_400Regular', 'System', 'sans-serif'],
        'sans-medium': ['Inter_500Medium', 'System', 'sans-serif'],
        'sans-semibold': ['Inter_600SemiBold', 'System', 'sans-serif'],
        'sans-bold': ['Inter_700Bold', 'System', 'sans-serif'],
        // Outfit (display/accent font)
        display: ['Outfit_500Medium', 'System', 'sans-serif'],
        'display-semibold': ['Outfit_600SemiBold', 'System', 'sans-serif'],
        'display-bold': ['Outfit_700Bold', 'System', 'sans-serif'],
        // DM Sans (search)
        search: ['DMSans_400Regular', 'System', 'sans-serif'],
        'search-medium': ['DMSans_500Medium', 'System', 'sans-serif'],
      },
      fontSize: {
        display: ['32px', { lineHeight: '1.2', letterSpacing: '-0.5px' }],
        'title-lg': ['26px', { lineHeight: '1.25', letterSpacing: '-0.3px' }],
        title: ['24px', { lineHeight: '1.3', letterSpacing: '-0.3px' }],
        h1: ['22px', { lineHeight: '1.3', letterSpacing: '-0.2px' }],
        h2: ['20px', { lineHeight: '1.35', letterSpacing: '-0.2px' }],
        h3: ['18px', { lineHeight: '1.4', letterSpacing: '0px' }],
        h4: ['17px', { lineHeight: '1.4', letterSpacing: '0px' }],
        'body-lg': ['16px', { lineHeight: '1.5', letterSpacing: '0px' }],
        body: ['15px', { lineHeight: '1.5', letterSpacing: '0px' }],
        'caption-lg': ['14px', { lineHeight: '1.4', letterSpacing: '0px' }],
        caption: ['13px', { lineHeight: '1.4', letterSpacing: '0.1px' }],
        small: ['12px', { lineHeight: '1.35', letterSpacing: '0.1px' }],
        overline: ['11px', { lineHeight: '1.3', letterSpacing: '0.8px' }],
        micro: ['10px', { lineHeight: '1.2', letterSpacing: '0.5px' }],
      },
      boxShadow: {
        card: '0 2px 12px #B4771215',
        'card-alt': '0 2px 12px #1A191808',
        preview: '0 4px 20px #B4771220',
        'tab-bar': '0 2px 12px #00000010',
        search: '0 2px 10px #00000012',
        dropdown: '0 4px 16px #00000018, 0 1px 4px #00000010',
        'auth-glow': '0 18px 56px rgba(245, 166, 35, 0.22), 0 32px 96px rgba(245, 166, 35, 0.08)',
        'bottom-sheet': '0 -4px 24px #B4771216',
      },
    },
  },
  plugins: [],
};
