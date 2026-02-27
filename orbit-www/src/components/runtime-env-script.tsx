import { getPublicEnvObject } from '@/lib/env'

/**
 * Injects public environment variables into the page as a global.
 * Place inside <head> in every root layout that renders <html>.
 *
 * This is a Server Component — it reads process.env at request time,
 * not at build time.
 */
export function RuntimeEnvScript() {
  const publicEnv = getPublicEnvObject()

  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `window.__RUNTIME_ENV=${JSON.stringify(publicEnv)};`,
      }}
    />
  )
}
