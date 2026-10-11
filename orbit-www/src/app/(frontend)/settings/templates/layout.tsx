import type { ReactNode } from 'react'
import { assertFeatureEnabled } from '@/lib/features'

/** Admin for the legacy /templates catalog; hidden with it (see templates/layout.tsx). */
export default function LegacyTemplatesSettingsLayout({ children }: { children: ReactNode }) {
  assertFeatureEnabled('legacyTemplates')
  return <>{children}</>
}
