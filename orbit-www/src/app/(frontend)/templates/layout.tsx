import type { ReactNode } from 'react'
import { assertFeatureEnabled } from '@/lib/features'

// Preview-feature gate reads the runtime env var, so never prerender at build time.
export const dynamic = 'force-dynamic'

/**
 * Legacy /templates (GitHub-repo template catalog, import, instantiate,
 * progress) is hidden: instantiation used placeholder workflow IDs and
 * simulated progress. The real flow is /self-service/templates.
 * Re-enable with ORBIT_ENABLE_PREVIEW_FEATURES=legacyTemplates.
 */
export default function LegacyTemplatesLayout({ children }: { children: ReactNode }) {
  assertFeatureEnabled('legacyTemplates')
  return <>{children}</>
}
