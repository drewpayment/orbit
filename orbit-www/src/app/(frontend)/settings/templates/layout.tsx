import type { ReactNode } from 'react'
import { assertFeatureEnabled } from '@/lib/features'

// Preview-feature gate reads the runtime env var, so never prerender at build time.
export const dynamic = 'force-dynamic'

/** Admin for the legacy /templates catalog; hidden with it (see templates/layout.tsx). */
export default function LegacyTemplatesSettingsLayout({ children }: { children: ReactNode }) {
  assertFeatureEnabled('legacyTemplates')
  return <>{children}</>
}
