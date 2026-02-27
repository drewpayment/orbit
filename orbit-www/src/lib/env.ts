/**
 * Runtime environment configuration.
 *
 * On the server:  reads process.env directly (bypassing Next.js compile-time replacement).
 * On the client:  reads window.__RUNTIME_ENV injected by RuntimeEnvScript.
 *
 * This enables "build once, deploy many" — NEXT_PUBLIC_ vars no longer need
 * to be known at build time.
 */

const PUBLIC_ENV_KEYS = [
  'NEXT_PUBLIC_APP_URL',
] as const

type PublicEnvKey = (typeof PUBLIC_ENV_KEYS)[number]
type PublicEnv = Record<PublicEnvKey, string | undefined>

declare global {
  interface Window {
    __RUNTIME_ENV?: PublicEnv
  }
}

/**
 * Read an env var at TRUE runtime, completely bypassing Next.js compile-time
 * inlining of NEXT_PUBLIC_* variables. We use globalThis.process to prevent
 * the bundler from recognizing the process.env pattern.
 */
function readServerEnv(key: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const env = (globalThis as any)['process']?.['env']
  return env?.[key] ?? ''
}

export function getEnv(key: PublicEnvKey): string {
  if (typeof window !== 'undefined') {
    return window.__RUNTIME_ENV?.[key] ?? ''
  }
  return readServerEnv(key)
}

export function getPublicEnvObject(): PublicEnv {
  const env = {} as PublicEnv
  for (const key of PUBLIC_ENV_KEYS) {
    env[key] = readServerEnv(key)
  }
  return env
}
