// Vitest setup
import '@testing-library/jest-dom/vitest';

// Mock ResizeObserver for components that use ScrollArea
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
