const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    // Mock image and asset files
    '\\.(png|jpg|jpeg|gif|webp|svg)$': '<rootDir>/__mocks__/fileMock.js',
    '^@/src/(.*)$': '<rootDir>/src/$1',
    '^@/(.*)$': '<rootDir>/$1',
    // Mock React Native and Expo modules for unit testing
    '^react-native$': '<rootDir>/__mocks__/react-native.js',
    '^expo-font$': '<rootDir>/__mocks__/expo-font.js',
    '^expo-constants$': '<rootDir>/__mocks__/expo-constants.js',
    '^expo-splash-screen$': '<rootDir>/__mocks__/expo-splash-screen.js',
    '^expo-router$': '<rootDir>/__mocks__/expo-router.js',
    '^@expo/vector-icons$': '<rootDir>/__mocks__/@expo/vector-icons.js',
    '^@expo/vector-icons/(.*)$': '<rootDir>/__mocks__/@expo/vector-icons.js',
    '^@gorhom/bottom-sheet$': '<rootDir>/__mocks__/@gorhom/bottom-sheet.js',
    '^react-native-gesture-handler$': '<rootDir>/__mocks__/react-native-gesture-handler.js',
    '^react-native-reanimated$': '<rootDir>/__mocks__/react-native-reanimated.js',
    '^nativewind$': '<rootDir>/__mocks__/nativewind.js',
    '^react-native-css-interop$': '<rootDir>/__mocks__/react-native-css-interop.js',
    '^react-native-css-interop/(.*)$': '<rootDir>/__mocks__/react-native-css-interop.js',
    '^expo-haptics$': '<rootDir>/__mocks__/expo-haptics.js',
    '^@maplibre/maplibre-react-native$': '<rootDir>/__mocks__/@maplibre/maplibre-react-native.js',
  },
  // Transform TypeScript and JSX using babel
  // We override babel config to avoid nativewind transformations in tests
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': [
      'babel-jest',
      {
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          ['@babel/preset-react', { runtime: 'automatic' }],
          ['@babel/preset-typescript', { onlyRemoveTypeImports: true }],
        ],
        // Disable nativewind babel transformations in tests
        babelrc: false,
        configFile: false,
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@testing-library)/)',
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/e2e/',
  ],
  // Module resolution for pnpm
  moduleDirectories: [
    'node_modules',
    path.join(__dirname, '../../node_modules'),
  ],
};
