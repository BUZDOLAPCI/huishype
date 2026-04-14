import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  define: {
    __DEV__: JSON.stringify(true),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/runtime/test/setup.ts'],
    css: true,
    globals: true,
    include: [
      'src/runtime/**/*.{test,spec}.{ts,tsx}',
      'src/providers/**/__tests__/signInWithMockToken.test.ts',
      'src/hooks/**/__tests__/useSavedProperties.test.ts',
      'src/utils/**/__tests__/*.{test,spec}.{ts,tsx}',
      'src/lib/**/__tests__/*.{test,spec}.{ts,tsx}',
      'src/lib/pdok/**/__tests__/*.{test,spec}.{ts,tsx}',
      'src/components/PropertyBottomSheet/**/sectionScroll.test.ts',
    ],
    exclude: ['e2e/**', 'app/**', 'src/lib/__tests__/currentLocation.test.ts'],
  },
});
