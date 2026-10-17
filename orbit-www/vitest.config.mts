import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  resolve: {
    alias: {
      // `server-only` is a Next.js build-time guard with no runtime module;
      // stub it so server-only modules can be unit-tested under vitest.
      'server-only': fileURLToPath(new URL('./vitest.server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx}',
      // Workspace-package unit tests (e.g. the automation Temporal worker under
      // services/automation-worker) live outside the app `src/` tree.
      'services/**/src/**/*.test.ts',
      // tests/int/* boot a live Payload instance against MongoDB (getPayload +
      // real collections). They only run when DATABASE_URI points at a database;
      // on a clean checkout they are left out so `test:int` needs no services.
      ...(process.env.DATABASE_URI ? ['tests/int/**/*.int.spec.ts'] : []),
    ],
  },
})
