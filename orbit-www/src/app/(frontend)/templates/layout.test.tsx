import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

import LegacyTemplatesLayout from './layout'
import LegacyTemplatesSettingsLayout from '../settings/templates/layout'

describe('legacy /templates route gate', () => {
  beforeEach(() => {
    vi.stubEnv('ORBIT_ENABLE_PREVIEW_FEATURES', '')
    vi.stubEnv('NEXT_PUBLIC_ORBIT_ENABLE_PREVIEW_FEATURES', '')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('returns notFound() for /templates/** while legacyTemplates is hidden', () => {
    expect(() => LegacyTemplatesLayout({ children: null })).toThrow('NEXT_NOT_FOUND')
  })

  it('returns notFound() for /settings/templates while legacyTemplates is hidden', () => {
    expect(() => LegacyTemplatesSettingsLayout({ children: null })).toThrow('NEXT_NOT_FOUND')
  })

  it('renders children when legacyTemplates is enabled', () => {
    vi.stubEnv('ORBIT_ENABLE_PREVIEW_FEATURES', 'legacyTemplates')
    expect(() => LegacyTemplatesLayout({ children: null })).not.toThrow()
    expect(() => LegacyTemplatesSettingsLayout({ children: null })).not.toThrow()
  })
})
