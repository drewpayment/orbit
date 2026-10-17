// Vitest setup
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { TextEncoder, TextDecoder } from 'util';
import { afterEach, vi } from 'vitest';

// Testing Library only auto-unmounts between tests when `afterEach` is a global,
// which this config doesn't enable (no `globals: true`). Without this, DOM from
// one test leaks into the next and queries like getAllByText(...)[0] hit stale
// elements whose handlers belong to an earlier test.
afterEach(() => {
  cleanup();
});

// Database seam: unit tests must not open a real MongoDB connection.
// Production modules (src/lib/auth.ts, src/lib/mongodb.ts, src/lib/setup.ts) call
// `new MongoClient(...)` at import time, which crashes when DATABASE_URI is unset.
// Replace only the client constructor; keep the rest of the driver (ObjectId,
// etc.) real so id handling in code under test behaves as in production.
// Any attempt to actually query the stub fails loudly instead of hanging.
// When DATABASE_URI is set (the DB-backed tests/int suites), use the real driver.
vi.mock('mongodb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('mongodb')>();
  if (process.env.DATABASE_URI) return actual;
  const noDb = (): never => {
    throw new Error('MongoDB is not available in unit tests; mock the module under test');
  };
  const collectionStub = new Proxy(
    {},
    { get: () => () => Promise.reject(new Error('MongoDB is not available in unit tests')) },
  );
  class MongoClientStub {
    constructor(_uri?: string, _options?: unknown) {}
    db() {
      return { collection: () => collectionStub, command: noDb, admin: noDb, listCollections: noDb };
    }
    connect() {
      return Promise.reject(new Error('MongoDB is not available in unit tests'));
    }
    close() {
      return Promise.resolve();
    }
    on() {
      return this;
    }
  }
  return { ...actual, MongoClient: MongoClientStub };
});

// Encryption seam: lib/encryption reads ENCRYPTION_KEY at import time. Provide a
// fixed 32-byte test key so tests don't need a real secret. Tests that need a
// specific key still set or stub it themselves.
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');

// Polyfill TextEncoder/TextDecoder for jose library
global.TextEncoder = TextEncoder as unknown as typeof global.TextEncoder;
global.TextDecoder = TextDecoder as unknown as typeof global.TextDecoder;

// Mock ResizeObserver for components that use ScrollArea
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Polyfill a spec-complete localStorage when the environment lacks one (jsdom's
// Storage can be partial depending on the `url` option). Guarded so we never clobber
// a working implementation.
if (typeof window !== 'undefined' && typeof window.localStorage?.clear !== 'function') {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

// jsdom does not implement matchMedia; provide a no-match stub so components that
// probe media queries (e.g. reduced motion) can render under vitest.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Mock pointer capture for Radix UI components
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture || (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture || (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture || (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
}
