import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
vi.mock('next/navigation', () => ({ notFound: () => notFound() }))

import {
  PREVIEW_FEATURES,
  PREVIEW_FEATURE_KEYS,
  assertFeatureEnabled,
  featureUnavailableMessage,
  filterByFeature,
  isFeatureEnabled,
  parseEnabledFeatures,
} from './features'

describe('parseEnabledFeatures', () => {
  it('returns an empty set for unset/blank values', () => {
    expect(parseEnabledFeatures(undefined).size).toBe(0)
    expect(parseEnabledFeatures(null).size).toBe(0)
    expect(parseEnabledFeatures('').size).toBe(0)
    expect(parseEnabledFeatures(' , ,').size).toBe(0)
  })

  it('parses comma separated keys, trimming and ignoring case', () => {
    const enabled = parseEnabledFeatures(' billing , KafkaSchemas ')
    expect([...enabled].sort()).toEqual(['billing', 'kafkaSchemas'])
  })

  it('ignores unknown keys', () => {
    const enabled = parseEnabledFeatures('billing,notAFeature,__proto__,constructor')
    expect([...enabled]).toEqual(['billing'])
  })

  it('`all` enables every preview feature', () => {
    expect(parseEnabledFeatures('all').size).toBe(PREVIEW_FEATURE_KEYS.length)
  })
})

describe('registry', () => {
  it('documents every feature with a label, reason and follow-up', () => {
    for (const key of PREVIEW_FEATURE_KEYS) {
      const f = PREVIEW_FEATURES[key]
      expect(f.label).toBeTruthy()
      expect(f.reason).toBeTruthy()
      expect(f.followUp).toBeTruthy()
    }
  })
})

describe('isFeatureEnabled / assertFeatureEnabled', () => {
  beforeEach(() => {
    notFound.mockClear()
    vi.unstubAllEnvs()
    vi.stubEnv('ORBIT_ENABLE_PREVIEW_FEATURES', undefined)
    vi.stubEnv('NEXT_PUBLIC_ORBIT_ENABLE_PREVIEW_FEATURES', undefined)
  })
  afterEach(() => vi.unstubAllEnvs())

  it('is disabled by default', () => {
    expect(isFeatureEnabled('billing')).toBe(false)
  })

  it('reads ORBIT_ENABLE_PREVIEW_FEATURES at call time', () => {
    vi.stubEnv('ORBIT_ENABLE_PREVIEW_FEATURES', 'billing')
    expect(isFeatureEnabled('billing')).toBe(true)
    expect(isFeatureEnabled('deployments')).toBe(false)
  })

  it('falls back to the NEXT_PUBLIC_ mirror used by client bundles', () => {
    vi.stubEnv('NEXT_PUBLIC_ORBIT_ENABLE_PREVIEW_FEATURES', 'deployments')
    expect(isFeatureEnabled('deployments')).toBe(true)
  })

  it('server runtime env wins over the build-time NEXT_PUBLIC copy, even when empty', () => {
    vi.stubEnv('NEXT_PUBLIC_ORBIT_ENABLE_PREVIEW_FEATURES', 'billing')
    vi.stubEnv('ORBIT_ENABLE_PREVIEW_FEATURES', '')
    expect(isFeatureEnabled('billing')).toBe(false)
    vi.stubEnv('ORBIT_ENABLE_PREVIEW_FEATURES', 'deployments')
    expect(isFeatureEnabled('billing')).toBe(false)
    expect(isFeatureEnabled('deployments')).toBe(true)
  })

  it('assertFeatureEnabled calls notFound() when the feature is hidden', () => {
    expect(() => assertFeatureEnabled('billing')).toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledTimes(1)
  })

  it('assertFeatureEnabled is a no-op when the feature is enabled', () => {
    vi.stubEnv('ORBIT_ENABLE_PREVIEW_FEATURES', 'billing')
    expect(() => assertFeatureEnabled('billing')).not.toThrow()
    expect(notFound).not.toHaveBeenCalled()
  })

  it('featureUnavailableMessage names the feature', () => {
    expect(featureUnavailableMessage('billing')).toContain(PREVIEW_FEATURES.billing.label)
  })
})

describe('filterByFeature (nav filtering)', () => {
  const nav = [
    { title: 'Catalog', url: '/catalog' },
    {
      title: 'Settings',
      url: '/settings',
      items: [
        { title: 'Connections', url: '/settings/connections' },
        { title: 'Templates', url: '/settings/templates', feature: 'legacyTemplates' as const },
      ],
    },
    { title: 'Billing', url: '/billing', feature: 'billing' as const },
  ]

  it('drops hidden entries at the top level and in children', () => {
    const out = filterByFeature(nav, new Set())
    expect(out.map((e) => e.title)).toEqual(['Catalog', 'Settings'])
    expect(out[1].items?.map((i) => i.title)).toEqual(['Connections'])
  })

  it('keeps entries whose feature is enabled', () => {
    const out = filterByFeature(nav, new Set(['legacyTemplates', 'billing'] as const))
    expect(out.map((e) => e.title)).toEqual(['Catalog', 'Settings', 'Billing'])
    expect(out[1].items?.map((i) => i.title)).toEqual(['Connections', 'Templates'])
  })

  it('does not mutate its input', () => {
    filterByFeature(nav, new Set())
    expect(nav[1].items).toHaveLength(2)
    expect(nav).toHaveLength(3)
  })
})
