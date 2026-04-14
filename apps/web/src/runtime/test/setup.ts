import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

Object.assign(globalThis, {
  jest: vi,
});
