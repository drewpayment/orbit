// Vitest setup
import '@testing-library/jest-dom/vitest';
import { TextEncoder, TextDecoder } from 'util';

// Polyfill TextEncoder/TextDecoder for jose library
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

// Mock ResizeObserver for components that use ScrollArea
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock pointer capture for Radix UI components
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture || (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
}
